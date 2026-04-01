Analyze the latest benchmark results and suggest targeted improvements to the novel harness.

## Steps

1. **Find the latest benchmark results.** Query the SQLite database at `data/harness.db`. Get the most recent run and check if a baseline exists. If the DB doesn't exist or has no runs, tell the user to run `bun benchmark/prose/run.ts` first and stop.

2. **Query the benchmark DB.** Use sqlite3 or Bun to query `data/harness.db`. Key queries:
   - `SELECT s.dimension, ROUND(AVG(s.score),1) as avg FROM scores s JOIN generations g ON s.generation_id=g.id WHERE g.run_id=(SELECT MAX(id) FROM runs WHERE benchmark_type='prose') AND g.passed=1 GROUP BY s.dimension` — per-dimension averages
   - `SELECT g.seed, s.dimension, ROUND(AVG(s.score),1) as avg FROM scores s JOIN generations g ON s.generation_id=g.id WHERE g.run_id=(SELECT MAX(id) FROM runs WHERE benchmark_type='prose') AND g.passed=1 GROUP BY g.seed, s.dimension` — per-seed breakdown
   - `SELECT g.id, g.seed, g.attempt, ROUND(AVG(s.score),1) as avg FROM generations g JOIN scores s ON s.generation_id=g.id WHERE g.run_id=(SELECT MAX(id) FROM runs WHERE benchmark_type='prose') AND g.passed=1 GROUP BY g.id ORDER BY avg ASC LIMIT 3` — weakest generations
   - `SELECT judge, dimension, score, reasoning FROM scores WHERE generation_id=?` — judge reasoning for weak generations
   - Compare to baseline: `SELECT s.dimension, ROUND(AVG(s.score),1) FROM scores s JOIN generations g ON s.generation_id=g.id JOIN runs r ON g.run_id=r.id WHERE r.is_baseline=1 AND g.passed=1 GROUP BY s.dimension`

3. **Identify the weakest dimensions.** Rank the 3 dimensions (Show/Tell, Dialogue, Sensory) by score. Focus on the bottom 1-2 — these are the improvement targets.

4. **Read the relevant agent files.** Based on which dimensions are weakest, read:
   - For Show/Tell, Voice, Sensory: `src/agents/writer/prompt.md`, `src/agents/writer/context.ts`, `src/agents/writer/config.ts`
   - For Dialogue: writer files + `src/agents/character-agent/prompt.md` (speech patterns feed dialogue)
   - For Beats: writer files + `src/agents/planning-plotter/prompt.md` (beat quality feeds prose)
   - Always read `src/agents/writer/context.ts` — context assembly order affects everything

5. **Read the weakest prose samples.** If benchmark JSON includes prose, read the 2 weakest. If not, check `output/benchmarks/` for any saved prose samples. Identify specific passages that demonstrate the weakness (e.g., a paragraph that tells instead of shows, dialogue where characters sound identical).

6. **Produce a diagnosis.** For each of the 2 weakest dimensions, output:
   ```
   ## [Dimension]: [score]/10

   **Problem**: What specifically is failing in the output, with a quoted example from the prose if available.

   **Root cause**: Which file and what part of it is causing this — be specific (e.g., "the writer prompt says X but the model interprets it as Y" or "character speech patterns are listed after scene beats so the model forgets them by the time it writes dialogue").

   **Suggested change**: The exact edit to make. For prompts, quote the current text and the replacement. For context.ts, describe the structural change. For config, state the parameter and new value.

   **Risk**: What might get worse if we make this change.
   ```

7. **Compare to iteration.md.** Read `docs/iteration.md` and check whether the suggested changes align with or contradict the improvement pathway already documented. Flag any conflicts.

## Rules

- Maximum 3 suggestions, prioritized by expected impact
- ONE variable per suggestion — never bundle multiple changes
- Never suggest adding new rules to a prompt — reword or restructure existing ones
- Be specific and actionable — "improve dialogue" is not useful, "swap lines 12-15 of context.ts so speech patterns appear inside each scene beat block" is
- Each suggestion should target a different root cause
- Include the file path and the exact text to change when possible
- If a dimension has improved since baseline, acknowledge it and skip it

$ARGUMENTS: Optional agent name to focus on (e.g., "writer", "planning-plotter"). If omitted, diagnose based on weakest dimensions.
