---
status: complete
updated: 2026-05-01
role: overnight-loop-context
experiment_id: 331

---

# L16 — NER Findings Persistence in halluc-ungrounded llm_calls — 2026-05-01

## Loop Contract

- Objective: Persist `nerFindings` and `nerOnlyFindings` from the halluc-ungrounded NER
  prepass into `llm_calls` so future LXC runs can audit AND-gate firing rates.
- Starting commit: 67b0d1b ([planning] Fix short obligation repair matching)
- Experiment ID: TBD (created during loop)
- Budget cap: $0.20
- Primary lever under test: Approach A — new `ner_prepass_json` JSONB column on `llm_calls`;
  `callAgent` returns `llmCallId`; `checkHallucUngrounded` patches the row post-call.
- Files/scripts expected to change:
  - `sql/034_llm_call_ner_prepass.sql` (new migration)
  - `src/db/ops.ts` (add `patchLLMCallNerPrepass`)
  - `src/llm.ts` (extend `AgentResult` to return `llmCallId`)
  - `src/agents/halluc-ungrounded/index.ts` (call patch after `callAgent`)
  - `src/agents/halluc-ungrounded/index.test.ts` (add persistence shape test)
  - `scripts/phase-eval/halluc-and-gate-summary.ts` (optional CLI)
  - `docs/decisions.md` (L16 entry)
- Evidence artifact: `llm_calls` row for halluc-ungrounded with `ner_prepass_json` populated
- Stop condition: serialization lands + tests pass + commit posted
- Escalation condition: persistence path turns out to require different approach than A

## Baseline

- Current behavior: `nerFindings` and `nerOnlyFindings` are computed in-process after the
  LLM call and are never written to DB. `llm_calls.response_content` only has the raw LLM
  JSON string.
- L11 Sonnet (exp #326) confirmed: "`nerFindings` is a post-LLM derived field not
  serialized to `response_content`."
- `llm_calls` schema (2026-05-01): id, run_id, timestamp, agent, phase, model, provider,
  temperature, max_tokens, prompt_tokens, completion_tokens, cached_tokens, latency_ms,
  tokens_per_sec, cost, chapter, seed, dimension, json_extraction_success,
  json_extraction_retried, zod_validation_success, zod_errors, http_attempts, retry_errors,
  system_prompt, user_prompt, response_content, novel_id, beat_index, attempt, request_json,
  failed, error_text. No `extras`, `tags`, or `metadata` column.

## Design Decision

Approach A: new `ner_prepass_json JSONB` column on `llm_calls`.

Rationale:
- `request_json` is the LLM request envelope (model/temperature/groundedSources) — not the
  right semantics for post-call derived data.
- `response_content` is raw LLM output text — NER findings are TypeScript-derived, not LLM output.
- A dedicated nullable column `ner_prepass_json` has clear semantics: present only when the
  NER prepass ran and the agent is halluc-ungrounded. All other agents leave it NULL.
- Backward-compatible: NULL by default, existing rows unaffected.

Implementation path:
1. `callAgent` extends `AgentResult<T>` to include `llmCallId?: number | null`
2. `logLLMCallStructured` already returns `number | null` — we surface it through `callAgent`'s
   return value.
3. After `callAgent` in `checkHallucUngrounded`, call `patchLLMCallNerPrepass(llmCallId, { nerFindings, nerOnlyFindings, andGateDecision, nerEnabled })`.
4. `patchLLMCallNerPrepass` is a minimal UPDATE in `src/db/ops.ts`.

## Command Plan

1. Write `sql/034_llm_call_ner_prepass.sql`
2. Apply migration on LXC
3. Add `patchLLMCallNerPrepass` to `src/db/ops.ts`
4. Extend `AgentResult` + `callAgent` in `src/llm.ts` to return `llmCallId`
5. Update `checkHallucUngrounded` in `src/agents/halluc-ungrounded/index.ts` to call the patch
6. Add persistence shape test to `src/agents/halluc-ungrounded/index.test.ts`
7. Add `scripts/phase-eval/halluc-and-gate-summary.ts` CLI
8. Create + conclude tuning_experiment
9. Update `docs/decisions.md`
10. Commit

## Progress Log

- [x] Session context written
- [x] Schema check confirmed (no extras/tags column)
- [x] Migration written (`sql/034_llm_call_ner_prepass.sql`)
- [x] Migration applied on LXC
- [x] `patchLLMCallNerPrepass` added to ops.ts
- [x] `callAgent` extended to return llmCallId
- [x] `checkHallucUngrounded` patched
- [x] Tests written and passing (40/40 total, 5 new)
- [x] CLI written (`scripts/phase-eval/halluc-and-gate-summary.ts`)
- [x] Experiment #331 created + concluded
- [x] Docs updated (decisions.md)
- [x] Committed

## Results

- Outcome: SHIPPED. Approach A. 5 new tests passing, 0 regressions.
- Evidence link/row/path: tuning_experiments.id=331; llm_calls.ner_prepass_json
- Cost: $0
- Commit(s): TBD

## Pickup Instructions

- Last safe command: schema check on LXC confirmed columns
- If failed, failure fingerprint: migration apply failure on LXC
- Next action: implement migration + code changes
