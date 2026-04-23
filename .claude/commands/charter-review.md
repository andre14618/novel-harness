Adversarial review of an experiment charter. Codex is the primary reviewer for this command — different model family from Claude gives a genuine divergent critique. Use Opus fallback (`experiment-adversary` subagent) only when Codex quota is exhausted or you want a second opinion.

## Usage

```
/charter-review <charter-path>
```

`<charter-path>` defaults to the most recently modified file in `docs/charters/` if omitted.

Examples:

```
/charter-review docs/charters/halluc-leak-v3.md
/charter-review                                    # auto-picks latest charter
/charter-review docs/charters/EXAMPLE-leak-v2-retroactive.md   # dry-run on the example
```

## Steps

1. **Resolve the charter path.** If the user passed `$ARGUMENTS`, use it. Otherwise find the most recently modified `docs/charters/*.md` that is not the template file. Confirm to the user which charter will be reviewed.

2. **Verify Codex is installed.** Run `which codex` via Bash. If missing, tell the user to run `/codex:setup` and stop — do not silently fall back to Opus.

3. **Read context the adversary will need cited.** Read these files so you can pass meaningful excerpts as focus text (Codex reads the repo but focused context produces sharper critique):
   - The charter file itself
   - `docs/experiment-adversary-prompt.md` — the reviewer framework (7 axes, verdict format)
   - `docs/experiment-design-rules.md` — the rule catalog the review cites
   - `docs/decisions.md` — for prior-decision confounds
   - Any prior charter in `docs/charters/` for the same adapter family

4. **Invoke Codex in the background.** Compose the focus text as:

   ```
   Adversarial review of the experiment charter at <CHARTER_PATH>.

   Load and follow docs/experiment-adversary-prompt.md as your review framework — the seven attack axes and the structured verdict output format are defined there, do not invent a different shape.

   Before emitting the verdict, read: docs/experiment-design-rules.md (especially §11 on lever selection), docs/decisions.md, and any prior charters in docs/charters/ for the same adapter family.

   Attack the charter on every axis. Cite §N.M of experiment-design-rules.md or exp #NNN in every blocking issue and warning. Emit the exact verdict block defined in docs/experiment-adversary-prompt.md — do not paraphrase the format.
   ```

   Then run (via SlashCommand tool if available, or by instructing the user to execute):

   ```
   /codex:adversarial-review --background <focus-text>
   ```

5. **Track the job.** Tell the user the job is running in background. Remind them to check with `/codex:status` and fetch results with `/codex:result` when it finishes. Typical charter review takes 2–5 minutes.

6. **When the user returns with the result**, paste the verdict block into the charter's §10 "Adversary review" table with the reviewer name `/codex:adversarial-review (GPT)` and today's date. Commit the charter update per `docs/commit-conventions.md`.

## Fallback to Opus

Only if Codex is unavailable (quota, outage, offline) or the user explicitly asks for a second opinion:

```
Agent(subagent_type: "experiment-adversary", prompt: "Review charter at <CHARTER_PATH>. Follow docs/experiment-adversary-prompt.md exactly.")
```

Record both verdicts in charter §10 if both reviewers ran. Disagreements between reviewers are load-bearing signal — flag them to the user explicitly; do not resolve silently.

## Rules

- Do NOT run training (`train-lora.py`) or benchmarks (`EXPERIMENT_ID=N`) from this command. Review only.
- Do NOT approve a RED or YELLOW verdict yourself — escalate to the user.
- Do NOT rewrite the charter based on the critique — that is the author's job after reading the verdict.
- Do NOT invoke both reviewers by default — Codex primary, Opus fallback. Running both doubles cost for marginal signal unless there's explicit reason.

$ARGUMENTS: path to the charter file (optional — defaults to most recent in `docs/charters/`)
