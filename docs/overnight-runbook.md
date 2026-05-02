---
status: active
updated: 2026-05-02
---

# Overnight Loop Runbook

How to start, monitor, stop, and audit a long unattended Claude loop on this harness. Closes the §12 todo "Document overnight runbook." Treat this as the durable companion to `docs/todo.md` §6 (overnight loop operating rules).

## Preconditions

Before kicking off an overnight session:

1. **Working tree clean.** `git status` must show no in-progress edits — overnight loops commit autonomously and an unstaged change can be silently absorbed into a subagent's commit.
2. **LXC reachable.** `ssh novel-harness-lxc "echo ok"` should succeed. Set up the SSH tunnel for Postgres if running anything that talks to the DB locally: `ssh -fNL 15432:127.0.0.1:5432 novel-harness-lxc`.
3. **`.env` populated.** `ORCHESTRATOR_DB_URL` must resolve to a working Postgres listener (the SSH tunnel is the standard local form).
4. **No active LXC generation.** `bash scripts/deploy-lxc.sh` checks for in-progress runs; if one is active, either let it finish or kill it before starting overnight work.
5. **Tests green.** `bun test src/` should pass at HEAD before starting — autonomous subagents will inherit any pre-existing breakage and may amplify it.
6. **Pre-loop gate clean.** Run `bun scripts/agent/preflight-loop.ts docs/sessions/<lane>.md` (add `--allow-dirty` only if the dirty files are intentionally part of the lane). The gate validates loop-contract completeness, starting commit, experiment id, declared file/script scope, and worktree state. Non-zero exit means do not launch the runner: 10 = lane-context, 20 = dirty worktree, 22 = git/infra.

## Starting an autonomous loop

The preferred unattended path is repo-supervised: create a lane doc, dry-run `lane-runner.ts`, then launch bounded worker cycles. Interactive `/loop` remains useful for manual Claude sessions, but it is not the source of truth for continuation. Each loop cycle:

1. Check the queue — read `docs/todo.md` for next-action items.
2. Pick one **primary lane**; write a session-context file under `docs/sessions/<DATE>-<LOOP>-<topic>.md` BEFORE editing code (per §6 todo rules).
3. Declare baseline, changed runtime lever, feedback signal, stop gate, and escalation rule.
4. Make the lane change, run tests, commit.
5. Update `docs/decisions.md` (concluded items) + `docs/todo.md` (close the bullet).
6. Let `lane-runner.ts` decide whether to start another worker cycle from `lane-status.ts`.

## Primary lane contract

A primary lane is the one causal hypothesis being validated by the loop. It can touch multiple files when the hypothesis requires it, but it should change only one runtime behavior bundle before smoke validation.

Allowed parallel support work:
- tests and parity harnesses
- docs-impact audits and commit-range audits
- operator summaries and stop classifiers
- replay/fixed-panel helpers
- result docs and session pickup notes

Not allowed in the same validation smoke unless explicitly part of the lane:
- changing checker thresholds while also changing writer prompts
- changing routing/model assignment while also changing prompt/schema shape
- changing planner context while also changing continuity policy
- changing retry policy while also changing the checker rubric that triggers it

The reason is attribution. If a smoke passes after multiple unrelated runtime changes, the repo cannot tell which change mattered. If it regresses, the repo cannot tell which change caused the regression.

Before any candidate prompt or checker change advances to live smoke, dry-run a replay-first plan over the saved fixed panels with `bun scripts/agent/replay-first-plan.ts <panel.jsonl> [--exp-id N] [--label probe-family:vN]`. The helper inventories rows, detects the checker shape, prints the oracle-label distribution and an estimated call count, and emits the exact `run-expanded-class-panel.ts` / `run-partial-enactment-panel.ts` follow-up command for replay. It never makes model calls; treat it as the cheap pre-smoke filter for halluc-ungrounded and adherence-events fixture panels.

DeepSeek V4 Flash concurrency is encouraged when it adds statistical power inside the active lane. Use it for repeated same-family runs, fixed-panel checker reruns, paired replay over saved `llm_calls`, or multi-seed confirmation after a single-seed signal. Before launching concurrent calls, declare:
- sample shape and N
- probe-family key / fixed panel identity
- budget cap and expected cost
- promotion gate or rejection gate
- which evidence artifact will persist the results

Do not use cheap concurrency to run several unrelated runtime lanes at once. That recreates the attribution problem at higher speed.

For LXC smoke-style loops (longer-running, real novel runs), the loop is structured around:
- Deploy: `bash scripts/deploy-lxc.sh`
- Launch: `ssh novel-harness-lxc "cd ~/apps/novel-harness && nohup bun src/index.ts ... > /tmp/<name>.log 2>&1 &"` — separate SSH per launch (per `feedback_lxc_nohup_separate_ssh`)
- Poll: `ScheduleWakeup` every ~120s with a check-back command (per `feedback_short_checkback_cadence`)
- Pull telemetry from `llm_calls` once novel reaches plan-assist or completes

## Where logs go

| Log | Path | Retained |
|---|---|---|
| Agent lane events | `output/agent-runs/<lane-id>/events.jsonl` | Until manual cleanup |
| Agent lane messages | `output/agent-runs/<lane-id>/messages.jsonl` | Until manual cleanup |
| LXC smoke novel runs | `/tmp/smoke-<name>-<seed>-<unix-ts>.log` on LXC | Until `/tmp` is cleared (boot/manual) |
| Local A/B / probe runs | Stdout — pipe through `tee output/phase-eval/<probe>/run-<ts>.log` (per `feedback_no_overwrite_runs`) | Forever (until manual cleanup) |
| Subagent transcripts | `/private/tmp/claude-501/<session-id>/tasks/<agent-id>.output` | Per-claude-session |
| Orchestrator service | `journalctl -u novel-harness-orchestrator -f` on LXC | systemd-journal default |

## Monitoring loops

Use the repo-local lane tools so Claude Code and OpenCode share the same outside-loop state:

```bash
bun scripts/agent/lane-heartbeat.ts docs/sessions/<lane>.md --actor opencode --step "running tests"
bun scripts/agent/lane-status.ts docs/sessions/<lane>.md --latest-novel
monitor
monitor --append
monitor --full
monitor --panel outside --panel coordination --panel evidence
bun scripts/agent/lane-runner.ts docs/sessions/<lane>.md --dry-run
bun scripts/agent/lane-runner.ts docs/sessions/<lane>.md --max-cycles 4 --max-hours 3 --model openai/gpt-5.5
bun scripts/agent/lane-runner.ts docs/sessions/<lane>.md --engine claude --model opus --permission-mode auto --max-cycles 30 --max-hours 8
bun scripts/agent/lane-runner.ts docs/sessions/<lane>.md --engine claude --model opus --permission-mode auto --max-cycles 30 --max-hours 8 --queue docs/sessions/lane-queue.md
bun scripts/agent/lane-runner.ts docs/sessions/<lane>.md --engine claude --model opus --permission-mode auto --worker-role captain --worker-id captain-claude --worker-io terminal
nohup bun scripts/agent/lane-runner.ts docs/sessions/<lane>.md --engine claude --model opus --permission-mode auto --max-cycles 30 --max-hours 8 --queue docs/sessions/lane-queue.md > /tmp/lane-runner-<lane-id>.log 2>&1 &
bun scripts/agent/lane-message.ts list docs/sessions/<lane>.md --open
bun scripts/agent/finalizer-packet.ts docs/sessions/<lane>.md --result "new blocker" --commit <sha> --evidence "experiment#<id>" --print
bun scripts/agent/finalize-docs.ts docs/sessions/<lane>.md --result "new blocker" --commit <sha> --evidence "experiment#<id>" --evidence "chapter_exhaustions#<id>"
bun scripts/agent/replay-first-plan.ts scripts/hallucination/expanded-fail-classes-panel.jsonl scripts/hallucination/synthetic-partial-enactment-fixtures/partial-enactment-panel.jsonl --label <probe-family> --exp-id <id>
```

`monitor` selects the latest non-template session doc with a complete Loop Contract. Human-facing monitoring instructions should default to bare `monitor`; use expanded `bun run monitor`, `bun scripts/agent/monitor.ts`, or `lane-dashboard` commands only when debugging the alias or working where the alias is unavailable. If none exists, it stays open in a waiting state and polls until one appears; `monitor --once` still exits immediately. Legacy session docs are skipped by default so they do not permanently show missing-field noise; pass a path explicitly to inspect one. `lane-status.ts` returns exit code `0` only when the outside loop should continue. It stops or blocks on missing lane-contract fields, stale heartbeat, explicit stop events, result stop gates, human-needed events, infra-failure events, and stale outside-loop state. The default `monitor` alias is compact: it hides latest-novel wall text and shows only `outside`, `coordination`, and `process`; its `Lane progress` block comes from the lane doc's latest `Progress Log` bullets and populated `Results` fields. Use `monitor --full` for all panels plus latest novel summary, or `--panel outside|inside|evidence|hygiene|process` to choose panels explicitly. In non-TTY/captured output, watch mode renders one snapshot instead of repeating forever unless `--append` is explicit.

For unattended work, use `lane-runner.ts` rather than trusting chat continuation. The runner launches bounded worker cycles only while lane-status remains `continue`, writes cycle artifacts under `output/agent-runs/<lane-id>/cycles/`, and stops on worker failure/timeout, max cycles, max hours, or no tracked workspace change. Default engine is OpenCode (`opencode run`); use `--engine claude` to make Claude Code the lane worker through `claude -p`. Always run `--dry-run` first to inspect the generated prompt and command. Avoid `--dangerously-skip-permissions` unless you explicitly accept the risk for that session.

For supervised work, add `--worker-io terminal`. This starts visible Claude Code without `-p`, or OpenCode TUI with `--prompt`, and the runner waits until the terminal worker exits before checking lane status again. Terminal mode requires an attached TTY and is not appropriate for `nohup`. Use it when you want to question the active worker, let it use native Claude/OpenCode interactive affordances, or keep it alive while background LXC validation runs. The worker should still record durable progress with `lane-heartbeat`; terminal chat is only live operator communication, not persistent lane state.

Give every runner an explicit identity with `--worker-role` and `--worker-id`. The coordination panel displays the active runner worker, latest heartbeat actor, claimed work by actor, and expired leases, so a walk-away session should make ownership obvious without reading full transcripts.

For cross-agent operational coordination, use `lane-message.ts`. The lane captain sends requests, evidence/support agents claim them with leases, and the assignee resolves them with evidence refs. `monitor --panel coordination` shows open messages, claimed work, and expired leases. This prevents the common failure mode where one agent launches a background replay and no visible owner remains responsible for monitoring it.

```bash
bun scripts/agent/lane-message.ts send docs/sessions/<lane>.md --actor captain --to evidence --kind request --subject "Monitor LXC replay" --body "Watch novel-123 until chapter 2 completes or gates" --ref "novel-123"
bun scripts/agent/lane-message.ts claim docs/sessions/<lane>.md <msg-id> --actor evidence --lease-minutes 30
bun scripts/agent/lane-message.ts resolve docs/sessions/<lane>.md <msg-id> --actor evidence --result "Replay gated on chapter_exhaustions.id=84" --ref "chapter_exhaustions#84"
```

For background launches, the `/tmp/lane-runner-<lane-id>.log` file is only the supervisor process log. The durable worker prompt, command, stdout, stderr, and result files live under `output/agent-runs/<lane-id>/cycles/`. Check `monitor --once` between cycles instead of relying on chat continuation.

When the queue stops with no next lane, use `docs/harness-next-work-process.md` to pick the next harness lane. It turns the backlog into one primary lane plus at most two queued follow-ups, with a specificity gate, ranking rubric, and review requirement.

Use `--queue docs/sessions/lane-queue.md` only with pre-created lane docs. The runner advances after a stopped lane only when `Outcome`, `Stop gate fired`, `Evidence link/row/path`, `Commit(s)`, and `Review` are filled in that lane's Results section. `Review` should cite independent commit-pinned review evidence such as `impl-review <sha> PASS`, or an explicit waiver reason and reviewer. It will not invent a new lane from a vague queue title while unattended.

The worker prompt now carries the end-of-lane finalization contract. Before a lane writes its stop gate for queue handoff, it should update durable docs (`docs/current-state.md`, `docs/todo.md`, `docs/decisions.md`, `docs/lessons-learned.md`, and the lane doc as applicable), conclude the experiment row, dry-run/apply stale-gate orphaning for classified evidence rows, run docs-impact and whitespace checks, record `Results: Review`, and commit the final docs/cleanup unit. This is the automated version of the manual sweep normally done by the supervising chat after a lane stops.

For systematic documentation handoff, use `scripts/agent/finalize-docs.ts`. It first writes a deterministic finalizer packet under `output/agent-runs/<lane-id>/` with required evidence, supporting activity, and inventory/warnings, then invokes the repo-local OpenCode `docs-finalizer` subagent on `deepseek/deepseek-v4-flash` with the high reasoning variant. The finalizer receives the lane/session context, packet path, and evidence refs, and is authorized to make a docs-only commit after `bun scripts/preflight-docs-impact.ts --strict` and `git diff --check` pass. The finalizer must stage only allowed documentation files and must not push.

Keep the inside-harness panel clean by resolving abandoned pending plan-assist gates as `orphaned` after dry-run review. This preserves evidence while removing rows from live monitoring:

```bash
bun scripts/operator-summary.ts --stale-gates --min-age-hours 24
bun scripts/agent/resolve-stale-gates.ts --older-than-hours 24
bun scripts/agent/resolve-stale-gates.ts --older-than-hours 24 --apply
```

For known completed smoke artifacts, resolve explicit IDs with a reason:

```bash
bun scripts/agent/resolve-stale-gates.ts --ids 78,81 --reason "validation evidence captured; no active generation" --apply
```

## Checking spend

Pull from `llm_calls` rather than computing per-token (memory `feedback_query_llm_calls_for_costs`):

```sql
-- per-experiment cost
SELECT lc.agent, COUNT(*) AS calls, SUM(lc.cost) AS spend
FROM llm_calls lc
WHERE lc.novel_id IN (
  SELECT n.id FROM novels n
  WHERE n.seed_json->>'experiment_id' = '<N>'
)
GROUP BY lc.agent
ORDER BY spend DESC;

-- session-wide spend (last 24h)
SELECT date_trunc('hour', timestamp) AS hr, SUM(cost) AS spend, COUNT(*) AS calls
FROM llm_calls
WHERE timestamp > now() - interval '24 hours'
GROUP BY hr ORDER BY hr;
```

Or use the operator-summary CLI:

```
bun scripts/operator-summary.ts <novel-id>
bun scripts/operator-summary.ts --latest
```

The DeepSeek V4 Flash overnight cap is **$26 across all loops** (`docs/todo.md` §6). Default per-loop cap: **$4** unless the loop has an explicit reason to exceed.

## Stopping safely

| Scenario | Action |
|---|---|
| Stop a running LXC novel mid-flight | `ssh novel-harness-lxc "ps aux \| grep 'bun src/index' \| grep -v grep \| awk '{print \$2}' \| xargs -r kill"` |
| Stop a local Bun script | Ctrl-C in the terminal that launched it; if launched via subagent, kill its agent process via `TaskStop <agent-id>` |
| Pause the orchestrator | `ssh novel-harness-lxc "sudo systemctl stop novel-harness-orchestrator"` (re-enable with `start`) |
| Unblock a stuck plan-assist gate | Mark the row decided: `UPDATE chapter_exhaustions SET decision='manual-stop', decided_at=now() WHERE id=<N>` |
| Cancel a pending DeepSeek call | The call is already in-flight at the provider; kill the bun process and the response is discarded but cost is incurred |

## Continuity-blocker plan-assist halts

A common autonomous-run halt class. As of 2026-05-02 (L37, evidence in L31d exp #358 + L37-data exp #361), chapter-level continuity blockers route directly to the plan-assist gate **on first attempt** — they do NOT consume the chapter-attempt retry budget. This is intentional design, not a bug.

**Mechanism** (`src/phases/drafting.ts:1116-1133`):
- After plan check + continuity check run in parallel on the draft, `buildCheckerBlockerDeviations` collects every `severity: "blocker"` continuity issue.
- Any non-empty result sets `pendingExhaustion` (`kind: "plan-check-exhausted"`) and `bail = true` immediately — even on attempt 1/3.
- In `--auto` mode, the gate fires `PipelineBailError`; the run halts.

**Why it exists:** continuity is the FINAL gate after beat-level rewrites and plan-check rewrites. The expectation is that the writer/beat-writer chain produces correct state propagation, and continuity catches the rare planner→prose divergence that escaped beat-level checking. A chapter-level continuity blocker typically means the prose contradicts a `mustEstablish` fact / character knowledge / world-bible rule that was set in a prior chapter, which a beat-level retry alone cannot fix (the writer would still get the same beat-brief lacking the rule).

**Cross-seed evidence (3 fantasy seeds):**
- `fantasy-debt` (L31d): chapter 2 attempt 1 — sole continuity blocker (ledger-color contradiction, ch1 had `mustEstablish: ledger glows red near false debts`).
- `fantasy-inscription` (L37-data): chapter 2 attempt 2 — continuity blocker co-occurring with 2 adherence beat blockers (Calla had-already-cut state divergence).
- `fantasy-system-heretic` (L37-data): zero continuity blockers across all 3 chapter-1 attempts (bailed on adherence-beat-blocker exhaustion instead).

**Operator response options (in priority order):**

1. **Edit the outline.** Inspect `chapter_exhaustions.unresolved_deviations` for the description; locate the conflicting beat in the chapter outline. If the rule the prose violated is genuinely missing from the next chapter's outline / beat briefs, edit the chapter outline to surface it explicitly:
   ```sql
   SELECT outline_json FROM chapter_outlines
   WHERE novel_id = '<id>' AND chapter_number = <N>;
   ```
   Add the rule as a `mustEstablish` fact or beat description detail; persist via `/api/novel/edit-plan`.

2. **Override.** If the continuity blocker is a model-level false positive (rare but possible — verify the planner state vs. the prose with `psql` lookups), resolve the gate with `action: "override"` via the orchestrator UI or:
   ```sql
   UPDATE chapter_exhaustions
   SET decided_at = now(), decision = 'override'
   WHERE id = <N>;
   ```

3. **Abort.** If the divergence is severe and the chapter would need significant rewriting, abort the chapter and consider the run failed:
   ```sql
   UPDATE chapter_exhaustions
   SET decided_at = now(), decision = 'abort'
   WHERE id = <N>;
   ```

**Heuristics for distinguishing real state divergence vs. transient writer hallucination:**

| Signal | Real state divergence | Transient hallucination |
|---|---|---|
| The contradicted fact appears in a prior chapter's `mustEstablish` (`SELECT outline_json FROM chapter_outlines WHERE chapter_number < <current>`) | yes | no — fact isn't actually established |
| The contradiction is reproducible (re-running the same beat produces the same wrong rendering) | yes | no — re-runs vary |
| The fact is in the world-bible (`SELECT world_bible_json FROM novels`) | yes | sometimes |
| The continuity description quotes specific contradicted state ("X had already done Y", "X glows Z when …") | yes (typically) | rarely |
| The chapter is in early novel (chapter 1, no prior state) | unusual | possible |

For real state divergences, the right fix is often to **edit the chapter outline** to surface the rule (Option 1). For transient hallucinations on rare beats, **override** is acceptable. Pure abort is rarely right unless the novel is so off-rails that the operator wants to start fresh.

**Why no automatic continuity-once retry (as of 2026-05-02):** L37 evaluated this and chose not to ship. Continuity blockers fire on ~22% of chapters that reach chapter 2 (2/9 across 3 seeds). Of those fires, only one was a sole continuity blocker; the other co-occurred with adherence beat blockers that a continuity-only retry would not have addressed. The dominant remaining halt class is **adherence-beat-blocker chapter-attempt exhaustion** (a separate problem) and the deeper writer-state-propagation issue (planned as L38). See `docs/decisions.md` §L37-data and `docs/l37-data-multiseed-2026-05-02.md`.

## Persisting + concluding experiments

Every loop must:
1. **Create** a tracked-work row before doing real work: `await createTuningExperiment('ticket', 'L<N> — <objective>', { config })`
2. **Conclude** with the result: `await concludeExperiment(<id>, '<one-paragraph result>')`
3. Reference the experiment ID in the commit subject or body (e.g. `[infra] ... (L<N>, exp #<id>)`).

If a loop crashes mid-work without concluding, the experiment row stays open. Audit with:

```sql
SELECT id, description, timestamp FROM tuning_experiments
WHERE conclusion IS NULL ORDER BY id DESC LIMIT 20;
```

Conclude orphans manually with `concludeExperiment(<id>, 'orphaned: <reason>')`.

## Audit after the session

Run this checklist when picking up a half-finished overnight session:

1. **`git log --oneline -30`** — what landed?
2. **`git status`** — anything uncommitted? (Subagents committing concurrently can leave race-condition residue; resolve before continuing.)
3. **`bash scripts/preflight-docs-impact.ts --commit <recent>`** — were runtime commits properly co-staged with `docs/current-state.md` or marked `docs-impact: none`?
4. **`bun test src/`** — anything broken?
5. **Conclude any orphan experiments** (see SQL above).
6. **Read every new `docs/sessions/<date>-L<N>-*.md`** for stop conditions and pickup instructions.
7. **Read every new `docs/decisions.md` entry from the session** for what was promoted vs deferred.

## Anti-patterns observed (don't repeat)

- **Sleep-loop polling**: chained `sleep 60 && check && sleep 60 && ...` in a single Bash call. The harness blocks long sleeps. Use `ScheduleWakeup` (delay-check) or `run_in_background` (wait-until-done) instead. Per `feedback_no_sleep_chains_for_polling`.
- **Skipping the durable session doc**: relying on chat history for next-loop context. Chat compresses; durable docs survive. Per §6 todo rule.
- **Bundling unrelated loop outcomes into one commit**: violates atomic-commit discipline; makes git revert risky. Per `feedback_atomic_commits`.
- **One-off ad-hoc benchmarks without `EXPERIMENT_ID`**: the data is useful only if it's findable later. Per `feedback_always_experiments` + `feedback_experiment_db`.
- **Negative-prime prompt rules** ("never X or Y"): consistently make models emit the forbidden tokens MORE. Use positive framing. Per `feedback_priming_suppression_ab`.
- **L25/L27 naming collisions**: when proposing a follow-up sprint, check existing experiment IDs and decisions.md headings before claiming the next L-number. Subagents have produced collisions when not enforcing this; rename with a `[docs] ... fixup` commit if discovered after the fact.
- **Ignoring the docs-impact check**: runtime commits without `docs/current-state.md` co-stage or `docs-impact: none` footer accumulate as silent doc drift. Run `bun scripts/preflight-docs-impact.ts --commit HEAD` after every runtime commit (or wire into a pre-commit hook).
- **Lane drift after a useful smoke**: closing the current blocker, then immediately editing another runtime layer before recording the stop class. Stop first, document the new cluster, then start the next primary lane.

## Cross-references

- `docs/todo.md` §6 — overnight loop operating rules
- `docs/experiment-design-rules.md` §12 — promotion thresholds
- `docs/commit-conventions.md` — commit prefixes + docs-impact footer convention
- `docs/sessions/overnight-loop-context-template.md` — required lane/session context skeleton
- `CLAUDE.md` — always-loaded operating contract
- `docs/lessons-learned.md` — methodology lessons from prior loops
- Memory files at `/Users/andre/.claude/projects/-Users-andre-Desktop-personal-projects-novel-harness/memory/` — user preferences and persistent feedback

## When to stop

A loop ends when one of these conditions fires:

- (a) Clean pass — acceptance criterion met; promote the change, document, commit, conclude experiment, end loop
- (b) New dominant blocker — target cluster is gone and a new out-of-scope cluster has clear evidence; document the cluster, propose follow-up sprint, end loop
- (c) Regression — prior cluster regresses; diagnose or revert before doing new work, document the regression, end loop
- (d) Infrastructure failure — DB, deploy, provider, test harness, logging, or missing evidence prevents interpretation; stop and fix the harness first
- (e) Cost cap crossed — document partial findings + remaining budget, end loop

The label is mandatory in the result doc and decisions.md entry. Without one, future loops can't tell whether the work was a win, a planned-followup, a regression, an infrastructure failure, or an exhausted budget. (Per `feedback_document_conclusions`.)
