# Autonomous Prompt Improvement

You are an autonomous improvement agent for the novel-harness. Read this file, then run the improvement loop until a stop condition is met. **Do not stop to ask for human input** — make decisions yourself. If something fails, diagnose and fix it or move on.

## Overview

This harness generates short novels via an LLM pipeline (world-building → plotting → drafting). Benchmark suites score the output on dimensions like "telling", "dead-weight", "dialogue-problems", "prose-craft", etc. Your job: improve prompt files to raise benchmark scores. Each iteration you edit a prompt, benchmark it, and keep or revert based on the score delta.

## Setup (do this once)

1. Read `docs/lessons-learned.md` — hard-won principles. Internalize them.
2. Run `bun scripts/agent/diagnose.ts` to find the weakest dimension. If a specific target was given in $ARGUMENTS, use `--target <target> --dimension <dimension>` instead. Note the current score — this is your **baseline**.
3. Create a git branch: `git checkout -b improve/<dimension>-$(date +%Y%m%d-%H%M)`
4. Create an experiment: `bun scripts/agent/create-experiment.ts --desc "<target>/<dimension>: improve from <score>" --target <target> --dimension <dimension>` — save the returned experiment ID. **All subsequent benchmark runs MUST use this experiment ID.**
5. Run `bun scripts/agent/experiment-history.ts --target <target> --dimension <dimension>` to see what was tried before. Don't repeat failed approaches.

## Loop (repeat for each iteration)

### 1. Gather context

- Read the current prompt file for the target agent (e.g., `src/agents/writer/prompt.md`)
- Review judge reasoning from the diagnosis output — understand *why* the dimension is weak
- If you have prior iteration results, analyze what worked and what didn't

### 2. Edit the prompt

Make a **targeted, single-concept change** to the prompt file. Examples of good changes:
- Add a specific rule with examples: "When showing emotion, describe physical sensation rather than naming the emotion"
- Restructure a section to emphasize overlooked elements
- Add a negative example showing what NOT to do
- Tighten vague language into concrete, actionable direction

### 3. Commit

```bash
git add <file>
git commit -m "[improve] <dimension>: <what you changed and why>"
```

The commit must happen BEFORE benchmarking so the experiment links to a meaningful git hash.

### 4. Deploy

```bash
bash scripts/deploy-lxc.sh
```

### 5. Benchmark

Run the benchmark on the LXC:

```bash
ssh novel-harness-lxc "cd ~/apps/novel-harness && EXPERIMENT_ID=<id> BENCHMARK_SEEDS=romance-drama BENCHMARK_RUNS=2 bun benchmark/prose/run.ts"
```

Adjust the benchmark command based on the target:
- `prose` → `benchmark/prose/run.ts`
- `planning` → `benchmark/planning/run.ts`
- `extraction` → `benchmark/extraction/run.ts`
- `continuity` → `benchmark/continuity/run.ts`

Wait for it to complete. **Capture the `Run ID: <N>` from the benchmark output** — you need it for scoring.

### 6. Evaluate

Get scores scoped to YOUR run (not "latest" — another session may have written a newer run):

```bash
bun scripts/agent/scores.ts --run-id <run_id>
```

Or scope to your experiment to see all your iterations together:

```bash
bun scripts/agent/scores.ts --experiment-id <experiment_id>
```

**Never use `--latest` when running concurrently.** It returns whichever session's benchmark finished last.

Compare the target dimension's score to your pre-change score (from diagnosis or previous iteration):
- **Delta >= 0.3** → KEEP. Proceed to next iteration.
- **Delta < 0.3** → REVERT. Run `git checkout -- <file>` and commit: `git commit -am "[revert] <dimension>: <brief explanation of why it didn't work>"`
- After reverting, deploy again before the next benchmark.

**Scoring convention**: All scores are higher = better. Penalty dimensions (telling, dead-weight, dialogue-problems) are stored as negative numbers (e.g., -5.2 means 5.2 issues). An improvement means the score gets closer to 0 (less negative). Quality dimensions (prose-craft, character-voice, sensory-grounding) are 1-10 where higher is better.

### 7. Record and repeat

Note what you learned from this iteration. Then go back to step 1 for the next iteration, armed with the new context.

## Stop conditions

**Do not stop early based on your own judgment.** Run until a mechanical limit is hit:
- You have completed **15 iterations** (or the count specified in $ARGUMENTS as `--max-iterations N`)
- You have **5 consecutive reverts** on the same dimension — you're hitting a ceiling

If the benchmark command itself fails 3 times in a row (infra failure, SSH error, etc.), stop and report the error.

## Constraints

### Files you MAY edit
- `src/agents/*/prompt.md` — agent prompt files (primary target)
- `src/agents/*/config.ts` — agent configuration (rare)
- `models/roles.ts` — model assignments (rare)

### Files you MUST NOT edit
- Anything in `benchmark/` — scoring code, rubrics, judge prompts
- Anything in `data/` or `sql/` — database layer
- Anything in `src/orchestrator/` — infrastructure
- Anything in `scripts/` — tooling
- This file (`program.md`)

### Rules
- **One conceptual change per iteration.** Don't bundle multiple ideas — you can't tell which one helped.
- **No wholesale rewrites.** Change at most 50% of lines in a prompt file. If you think the whole prompt needs rethinking, do it incrementally across multiple iterations.
- **Never estimate scores.** Always get them from `bun scripts/agent/scores.ts` or the benchmark output.
- **Always deploy before benchmarking.** The LXC runs the deployed code, not your local edits.
- **Always commit before benchmarking.** Experiments link to git hashes — uncommitted changes can't be reproduced.
- **Don't repeat failed approaches.** Check experiment history. If "add more sensory detail examples" was tried and reverted, try a different angle.
- **Watch for regressions.** If you notice other dimensions dropping while your target improves, note it. A change that improves telling by 0.5 but worsens prose-craft by 1.0 is a bad trade.

## When done

1. Conclude the experiment:
   ```bash
   bun scripts/agent/conclude-experiment.ts --id <id> --conclusion "<summary>"
   ```
   Include: iterations run, kept/reverted ratio, starting → ending score, key learnings about what worked.

2. Push the branch: `git push -u origin improve/<dimension>-<date>`

3. Print a final summary for the human reviewer.

## Ad-hoc database queries

The helper scripts cover common operations, but you can also query Postgres directly for anything else. The database is on the LXC. Use:

```bash
ssh novel-harness-lxc "psql -U orchestrator -d novel_harness_orchestrator -c '<SQL>'"
```

Useful tables: `runs`, `generations`, `scores`, `llm_calls`, `tuning_experiments`, `improvement_cycles`, `improvement_iterations`, `baselines`.
