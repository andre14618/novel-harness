---
title: LLM Call Inspector
status: active
added: 2026-04-08
---

# LLM Call Inspector

A tagged, searchable view of every LLM call the harness makes — system prompt, user prompt, response, and the drill-down keys to find a specific point in the pipeline (novel → chapter → beat → attempt).

This is the home for context engineering. If you're trying to figure out *why* the writer produced what it produced, you start here.

## Where to find it

- **Web UI**: `/app/llm-calls` (nav item: **Inspector**). Sign in at `/login` first — the `?key=` URL fallback has been removed.
- **API**:
  - `GET /api/novel/llm-calls?novel_id=…&agent=…&chapter=…&beat_index=…&limit=…` — list view (metadata only)
  - `GET /api/novel/llm-calls/:id` — single row with full prompt + response text
  - `GET /api/novel/llm-calls/agents?novel_id=…` — distinct agent names for the filter dropdown
- **SQL**: see "SQL workflows" below
- **Slash command**: `/inspect-context <question>` runs the canonical investigation flow

## What gets stored

Every call to `executeAndLog()` (`src/llm.ts`) and `callAgent()` (`src/llm.ts`) now persists the following on the `llm_calls` row:

| Column | Source | Notes |
|---|---|---|
| `system_prompt` | `request.systemPrompt` | Full text |
| `user_prompt` | `request.userPrompt` | Full text — for beat-writer this is the assembled context from `buildBeatContext()` |
| `response_content` | `response.content` | Full LLM output (raw, before JSON extraction). NULL if the call failed before producing a response. |
| `request_json` | full request envelope minus prompts | JSONB. `{provider, model, temperature, maxTokens, responseFormat, extraBody, …}`. Lets you replay a request without guessing flags. |
| `failed` | `true` if the call threw or its retries exhausted | Default `false`. Always set — every attempt produces exactly one row. |
| `error_text` | error message + stack | Populated when `failed = true`. Never NULL on failure. |
| `novel_id` | passed by `logLLMCallStructured(novelId, …)` | Identifies which novel the call belongs to |
| `chapter` | `tags.chapter` | Set by callers that know which chapter they're in |
| `beat_index` | `tags.beatIndex` | Zero-indexed beat number, populated for `beat-writer`, `adherence-checker`, `tonal-pass` |
| `attempt` | `tags.attempt` | Retry counter (1-indexed) — the same beat across attempts shares `(chapter, beat_index)` |

Calls logged before `sql/017_llm_call_inspection.sql` have NULL prompt fields. Calls logged before `sql/018_llm_call_errors.sql` have NULL `request_json`/`error_text` and `failed = false`.

### Always-log guarantee

The inspector is intended to be the single source of truth for "what happened" — *successes and failures both*. Both `executeAndLog()` and `callAgent()` use a `try/catch/finally` pattern that guarantees one row per attempt, even if:

- The HTTP request to the provider throws
- All retries are exhausted
- JSON extraction or zod validation fails after the response came back
- An unexpected exception escapes

If `failed = true`, the row will have `error_text` populated and (usually) `response_content = NULL`. The `request_json` field is populated regardless, so you can reproduce the exact request that blew up.

### Which agents get beat-level tags?

| Agent | novel_id | chapter | beat_index | attempt |
|---|:---:|:---:|:---:|:---:|
| `beat-writer` | ✅ | ✅ | ✅ | ✅ |
| `adherence-checker` | ✅ | ✅ | ✅ | ✅ (matches the beat-writer attempt) |
| `reference-resolver` | ✅ | ✅ | — | — |
| `continuity` | ✅ | ✅ | — | ✅ |
| `chapter-plan-checker` | ✅ | ✅ | — | ✅ |
| `writer` (chapter-level fallback) | ✅ | ✅ | — | ✅ |
| `rewriter` | ✅ | ✅ | — | ✅ |
| `tonal-pass` | ✅ | ✅ | ✅ (paragraph index) | — |
| `summary-extractor` / `fact-extractor` / `character-state` / `relationship-timeline` / `graph-linker` | ✅ | ✅ | — | — |
| `planning-plotter` | ✅ | — | — | ✅ |
| `world-builder` / `character-agent` / `plotter` (concept) | ✅ | — | — | ✅ |

`novel_id` is always populated when `logLLMCallStructured()` runs inside a novel run. Every callAgent site in the live pipeline now sets at least `chapter` (where chapter is in scope) and `attempt` (where retries exist).

## Common workflows

### "What did the writer see for chapter 2 beat 3?"

1. Open `/app/llm-calls`.
2. Filter: novel = your novel, agent = `beat-writer`, chapter = 2, beat = 3.
3. Click the row. The user prompt panel is the full assembled context — beat spec, transition bridge, character snapshots, resolved references, setting.
4. Read top to bottom. If something's missing, the bug is in `src/agents/writer/beat-context.ts`, not the LLM.

### "Compare attempt 1 vs attempt 2 of a retried beat"

1. Filter to a single beat (`agent=beat-writer`, `chapter=N`, `beat_index=M`).
2. The list shows all attempts in reverse-chronological order. Open each.
3. The user prompt of attempt 2 will have a `RETRY — previous attempt deviated.` suffix. Diff the responses to see what the model changed.

### "Why did adherence-checker fail this beat?"

1. Filter to `agent=adherence-checker` for the same `(novel_id, chapter, beat_index)`.
2. Open the failing call. The response is JSON: `{ pass, deviations }`. The `deviations` array tells you what the checker objected to.
3. Find the matching `beat-writer` call (same `chapter`/`beat_index`/`attempt`) and read the prose it produced. Compare to the deviations.

### "Did the reference resolver actually find the world system Howard expected?"

1. Filter to `agent=reference-resolver` for the novel and chapter. (Reference resolver isn't tagged with `beat_index` — it's pre-fetched in parallel for all beats before the serial writing loop, so beat ordering is non-deterministic.)
2. Open recent calls. The response shows what the resolver returned. If the system isn't there, either (a) it's not in the world bible, (b) the beat description didn't trigger a lookup, or (c) the LLM lookup branch returned nothing.

### "Show me every failure for this novel"

1. Open `/app/llm-calls`, filter to your novel, tick **errors only**.
2. Failed rows are highlighted red and show `FAIL` in the status column.
3. Click any failure: the **Error** panel pinned at the top shows the full error text. The **Request envelope** section shows the exact provider/model/params for replay. The user prompt is still there (failures don't drop the prompt).
4. If `attempt > 1` and prior attempts succeeded, sort by `id` ascending and walk forward — the inspector lets you watch a retry chain converge or diverge.

### "Replay a failed call by hand"

1. Open the failed row, copy the `request_json` envelope.
2. Combine with `system_prompt` + `user_prompt` and POST directly to the provider's chat-completions endpoint. The envelope contains everything `src/transport.ts` would have sent except the prompt strings.

### "Show me every call that produced this chapter"

```sql
SELECT id, agent, beat_index, attempt, prompt_tokens, completion_tokens, latency_ms, cost
  FROM llm_calls
 WHERE novel_id = $1 AND chapter = $2
 ORDER BY id;
```

This is the chronological execution log for the chapter. Useful for "why is chapter 5 so expensive?" — it shows which agent burned the tokens.

## SQL workflows

Connect via `data/connection.ts` from inside the harness, or `ssh novel-harness-lxc` + `sudo -u postgres psql novel_harness_orchestrator` for a one-off poke.

```sql
-- All beat-writer calls for one chapter, in beat order, with attempts
SELECT id, beat_index, attempt, prompt_tokens, completion_tokens, latency_ms,
       LENGTH(user_prompt) as prompt_chars,
       LENGTH(response_content) as response_chars
  FROM llm_calls
 WHERE novel_id = $1 AND chapter = $2 AND agent = 'beat-writer'
 ORDER BY beat_index, attempt;

-- Full prompt + response for one call
SELECT system_prompt, user_prompt, response_content
  FROM llm_calls WHERE id = $1;

-- Beats that needed multiple attempts (likely adherence failures)
SELECT chapter, beat_index, MAX(attempt) as attempts
  FROM llm_calls
 WHERE novel_id = $1 AND agent = 'beat-writer'
 GROUP BY chapter, beat_index
HAVING MAX(attempt) > 1
 ORDER BY chapter, beat_index;

-- Token cost broken down by agent for one novel
SELECT agent, COUNT(*), SUM(prompt_tokens), SUM(completion_tokens), SUM(cost)::numeric(10,4)
  FROM llm_calls
 WHERE novel_id = $1
 GROUP BY agent
 ORDER BY SUM(cost) DESC;

-- All failures for a novel, with the error and the request envelope
SELECT id, agent, chapter, beat_index, attempt, error_text,
       request_json->>'provider' as provider, request_json->>'model' as model
  FROM llm_calls
 WHERE novel_id = $1 AND failed = true
 ORDER BY id DESC;

-- Failure rate per agent (rough health check)
SELECT agent,
       COUNT(*) FILTER (WHERE failed) as failures,
       COUNT(*) as total,
       ROUND(100.0 * COUNT(*) FILTER (WHERE failed) / COUNT(*), 1) as fail_pct
  FROM llm_calls
 WHERE novel_id = $1
 GROUP BY agent
 ORDER BY fail_pct DESC;
```

## Schema

Two additive migrations:

- `sql/017_llm_call_inspection.sql` — adds `system_prompt`, `user_prompt`, `response_content`, `novel_id`, `chapter`, `beat_index`, `attempt`, and the `(novel_id, chapter, beat_index)` index.
- `sql/018_llm_call_errors.sql` — adds `request_json` (jsonb), `failed` (boolean, NOT NULL DEFAULT false), `error_text`, and a partial index on `failed = true` for fast "errors only" filtering.

Both are additive — existing rows get defaults, and pre-existing read paths still work.

## Extending tag coverage

All callAgent sites in the live pipeline (concept, planning, drafting, validation, extraction, tonal-pass) currently set `novel_id` + `chapter` + `attempt` where applicable. Beat-level tags flow through `beat-writer`, `adherence-checker`, and `tonal-pass` (the latter uses `beat_index` for paragraph index).

To add tags to a new agent:

1. Find the call site.
2. If it uses `callAgent()`, add `chapter` / `beatIndex` / `attempt` to the config object — they're already part of `AgentConfig`.
3. If it uses `executeAndLog()`, pass the tags as the fourth argument (`{ chapter, beatIndex, attempt }`).
4. The logger, DB layer, and inspector UI all handle the rest — no schema or query changes needed.

## Storage notes

A typical 3-chapter novel produces ~150 LLM calls. With ~5KB of text per beat-writer call and smaller for the rest, expect ~500KB-1MB of text per novel. Postgres TOAST stores anything over ~2KB out-of-line, so the main `llm_calls` rows stay small and the prompt text only loads when the inspector drills into a row.

There's no retention policy. If storage becomes a problem (it won't for a while), the simplest cleanup is `UPDATE llm_calls SET system_prompt=NULL, user_prompt=NULL, response_content=NULL WHERE timestamp < now() - interval '90 days'`. The metadata stays for cost analysis.

## Related

- `src/agents/writer/beat-context.ts` — beat context assembly (the thing the user prompt mostly is, for `beat-writer`)
- `src/phases/drafting.ts` — drafting loop, the only place that currently sets beat-level tags
- `.claude/commands/inspect-context.md` — the slash command that runs the canonical investigation flow
- `docs/world-knowledge-graph.md` — what the planner / reference resolver are pulling from
