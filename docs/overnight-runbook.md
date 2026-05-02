---
status: active
updated: 2026-05-01
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

## Starting an autonomous loop

The conventional invocation is `/loop` in dynamic mode (the assistant self-paces wakeups via `ScheduleWakeup`). Each loop cycle:

1. Check the queue — read `docs/todo.md` for next-action items.
2. Pick one orthogonal task; write a session-context file under `docs/sessions/<DATE>-<LOOP>-<topic>.md` BEFORE editing code (per §6 todo rules).
3. Make the change, run tests, commit.
4. Update `docs/decisions.md` (concluded items) + `docs/todo.md` (close the bullet).
5. Loop back to step 1 OR sleep until next condition.

For LXC smoke-style loops (longer-running, real novel runs), the loop is structured around:
- Deploy: `bash scripts/deploy-lxc.sh`
- Launch: `ssh novel-harness-lxc "cd ~/apps/novel-harness && nohup bun src/index.ts ... > /tmp/<name>.log 2>&1 &"` — separate SSH per launch (per `feedback_lxc_nohup_separate_ssh`)
- Poll: `ScheduleWakeup` every ~120s with a check-back command (per `feedback_short_checkback_cadence`)
- Pull telemetry from `llm_calls` once novel reaches plan-assist or completes

## Where logs go

| Log | Path | Retained |
|---|---|---|
| LXC smoke novel runs | `/tmp/smoke-<name>-<seed>-<unix-ts>.log` on LXC | Until `/tmp` is cleared (boot/manual) |
| Local A/B / probe runs | Stdout — pipe through `tee output/phase-eval/<probe>/run-<ts>.log` (per `feedback_no_overwrite_runs`) | Forever (until manual cleanup) |
| Subagent transcripts | `/private/tmp/claude-501/<session-id>/tasks/<agent-id>.output` | Per-claude-session |
| Orchestrator service | `journalctl -u novel-harness-orchestrator -f` on LXC | systemd-journal default |

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

## Cross-references

- `docs/todo.md` §6 — overnight loop operating rules
- `docs/experiment-design-rules.md` §12 — promotion thresholds
- `docs/commit-conventions.md` — commit prefixes + docs-impact footer convention
- `CLAUDE.md` — always-loaded operating contract
- `docs/lessons-learned.md` — methodology lessons from prior loops
- Memory files at `/Users/andre/.claude/projects/-Users-andre-Desktop-personal-projects-novel-harness/memory/` — user preferences and persistent feedback

## When to stop

A loop ends when one of these conditions fires:

- (a) Acceptance criterion met — promote the change, document, commit, conclude experiment, end loop
- (b) NEW out-of-scope cluster found — document the cluster, propose follow-up sprint, end loop
- (c) Prior cluster regresses — roll back the offending commit, document the regression, end loop
- (d) Cost cap crossed — document partial findings + remaining budget, end loop

The label is mandatory in the result doc and decisions.md entry. Without one, future loops can't tell whether the work was a win, a planned-followup, a regression, or an exhausted budget. (Per `feedback_document_conclusions`.)
