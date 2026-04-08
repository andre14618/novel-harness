Inspect what an agent received and produced for a given novel/chapter/beat. Use the LLM Call Inspector to investigate context engineering questions, debug a bad beat, or verify that planned state actually reached the writer.

## When to use this

- "Why did the writer ignore the planned facts in chapter 2?"
- "Did the reference resolver actually return the world system Howard expected?"
- "Compare the beat-writer prompt for beat 3 attempt 1 vs attempt 2 — what changed on retry?"
- "What did the continuity checker actually see when it flagged that issue?"
- "Why did the extractor fail on chapter 5? What error did it throw?"
- "Show me every failed call for this novel."
- Anything where you need to read the exact prompt + response, not just metadata.

## Background

`llm_calls` stores the full system prompt, user prompt, and response content for every call (since `sql/017_llm_call_inspection.sql`), plus the request envelope and error text on failures (since `sql/018_llm_call_errors.sql`). Drill-down tags: `novel_id`, `chapter`, `beat_index`, `attempt`.

**Always-log guarantee:** every call attempt (success or failure) produces exactly one row. Failed calls have `failed = true`, `error_text` populated, `request_json` populated for replay. This is non-negotiable — if you ever see a beat that "vanished" without an `llm_calls` row, that's a logging bug, not normal behavior.

**Tag coverage:** every callAgent site in the live pipeline now sets `novel_id` + `chapter` (where chapter is in scope) + `attempt` (where retries exist). Beat-level `beat_index` is populated for `beat-writer`, `adherence-checker`, and `tonal-pass` (paragraph index). See `docs/llm-call-inspector.md` for the full coverage matrix.

## Steps

1. **Identify the question.** Get a clean statement from the user: which novel, which chapter/beat, which agent. If the user only has a symptom ("the chapter feels off"), ask which chapter and which dimension you should look at.

2. **Open the inspector first if you can.** The fastest path is `http://novel-harness:3006/app/llm-calls?key=<ORCHESTRATOR_API_KEY>`. Filter by novel + agent + chapter + beat. Click a row for the full prompt/response. If you're working in the terminal, use SQL (step 3).

3. **SQL fallback.** Query the LXC Postgres directly via `data/connection.ts`. Always check `information_schema.columns` first if you're unsure of a column name. Useful patterns:

   ```sql
   -- All beat-writer calls for a specific chapter, with attempts
   SELECT id, beat_index, attempt, failed, prompt_tokens, completion_tokens, latency_ms
     FROM llm_calls
    WHERE novel_id = $1 AND chapter = $2 AND agent = 'beat-writer'
    ORDER BY beat_index, attempt;

   -- Full prompt + response for one call
   SELECT system_prompt, user_prompt, response_content, request_json, error_text
     FROM llm_calls WHERE id = $1;

   -- Compare attempts for the same beat
   SELECT attempt, failed, user_prompt, response_content, error_text
     FROM llm_calls
    WHERE novel_id = $1 AND chapter = $2 AND beat_index = $3 AND agent = 'beat-writer'
    ORDER BY attempt;

   -- All calls (any agent) for one chapter, in execution order
   SELECT id, agent, beat_index, attempt, failed, prompt_tokens
     FROM llm_calls
    WHERE novel_id = $1 AND chapter = $2
    ORDER BY id;

   -- All failures for a novel, with the error
   SELECT id, agent, chapter, beat_index, attempt, error_text
     FROM llm_calls
    WHERE novel_id = $1 AND failed = true
    ORDER BY id DESC;
   ```

4. **Read the beat context assembly code if the question is structural.** `src/agents/writer/beat-context.ts` shows how the user prompt is built — beat spec, transition bridge, character snapshots, resolved references, setting. If a section is missing from a stored prompt, the bug is in `buildBeatContext()`, not the LLM.

5. **Compare to expectations.** State what *should* be in the context based on the planner output (`chapter_outlines.outline_json`), the world bible, character states. Then state what *was* in the context. The diff is the answer.

6. **Report the finding.**
   - Quote the exact prompt section that's wrong (or absent).
   - Point at the file/line where the assembly happened.
   - If the LLM ignored present context, the fix is the prompt or the model. If context was missing, the fix is `buildBeatContext()` or the upstream data (planner, reference resolver, world state).

## Rules

- Never paraphrase the prompt — copy the exact text.
- Don't propose a fix without showing the input that produced the bad output.
- If the prompt fields are NULL, the call predates `sql/017_llm_call_inspection.sql` — say so and stop. Don't pretend there's nothing to find.
- Beat-level tags (`beat_index`, `attempt`) are only populated for `beat-writer` and `adherence-checker`. Other agents get NULL there — filter by `agent` instead.
- One question per investigation. Don't fan out into "while we're here…" rewrites.

$ARGUMENTS: Free-form question about a specific call, beat, or context. Examples: "what did beat-writer see for chapter 2 beat 3", "why did adherence-checker fail beat 1 of chapter 1", "show me the continuity checker's prompt for novel X chapter 4".
