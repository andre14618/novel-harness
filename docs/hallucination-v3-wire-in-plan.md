---
status: active
kind: implementation-plan
produced-by: Codex (gpt-5.4, high-effort, session 019da28c-1602-7852-8b54-cfb986b25dbf)
produced-for: Claude (implementation)
date: 2026-04-18
---

# Hallucination V3 Wire-In Plan

Produced by Codex at Claude's request after the 2026-04-18 directional review identified item #3 (hallucination v3 wire-in) as independent of the three RED charters. The adapters `halluc-ungrounded-v2:v1` and `halluc-leak-salvatore-v1:v1` have been evaluated and are W&B-live; they are not invoked at runtime yet. This document is the commit-by-commit plan Claude will execute.

## 1. Sequence overview

No charter commit. Skip it: this is not a new experiment, training run, or methodology change; it is pure runtime wire-in of adapters already chosen and evaluated.

1. Add `halluc-ungrounded` agent module with training-shape prompt builder and schema.
2. Add `halluc-leak-salvatore` agent module with prose-only prompt builder and schema.
3. Register both agents in runtime config/telemetry surfaces.
4. Wire both agents into the beat retry loop with a local unified beat-issue aggregator; update `docs/current-state.md` in the same commit.
5. Add thin unit tests for prompt-shape and issue aggregation behavior.
6. Update backlog/context docs to mark wire-in done and measurement still pending.

## 2. Per-commit spec

### Commit 1
**Prefix**: `[agent:halluc-ungrounded]`
**Files to create or modify**:
`src/agents/halluc-ungrounded/context.ts`
`src/agents/halluc-ungrounded/schema.ts`
`src/agents/halluc-ungrounded/index.ts`
`src/agents/halluc-ungrounded/halluc-ungrounded-system.md`
`src/agents/halluc-ungrounded/context.test.ts`
**Summary of the change**: build the grounded-context checker module. `context.ts` must emit the same shape used in `scripts/hallucination/format-sft.ts`: beat brief, relevant world-bible names, speakers, prose. `schema.ts` defines `{ pass, issues: [{ entity, excerpt }] }`. `index.ts` exports prompt/schema/context plus `checkHallucUngrounded(...)` that calls `callAgent()` and converts call failure into a blocking issue instead of throwing.
**Verification gates**: all 5 canonical gates.
**Rollback behavior**: standalone and dormant; nothing in runtime uses it yet.
**docs-impact line**: `docs-impact: none`

### Commit 2
**Prefix**: `[agent:halluc-leak-salvatore]`
**Files to create or modify**:
`src/agents/halluc-leak-salvatore/context.ts`
`src/agents/halluc-leak-salvatore/schema.ts`
`src/agents/halluc-leak-salvatore/index.ts`
`src/agents/halluc-leak-salvatore/halluc-leak-salvatore-system.md`
`src/agents/halluc-leak-salvatore/context.test.ts`
**Summary of the change**: build the Salvatore leak checker module. `context.ts` is prose-only. `schema.ts` defines `{ has_leak, leaks: string[] }`. `index.ts` exports prompt/schema/context plus `checkHallucLeakSalvatore(...)` that returns a normalized result and never throws into the drafting loop.
**Verification gates**: all 5 canonical gates.
**Rollback behavior**: standalone and dormant.
**docs-impact line**: `docs-impact: none`

### Commit 3
**Prefix**: `[feat]`
**Files to create or modify**:
`src/models/roles.ts`
`src/logger.ts`
`src/orchestrator/novel-routes.ts`
**Summary of the change**: add the two new agent entries to `AGENT_MODELS`; map both agent names to `drafting` in `logger.ts`; expose both in the config UI grouping so operators can see/override them.
**Verification gates**: all 5 canonical gates.
**Rollback behavior**: standalone; adds visible config only, no runtime wire-in yet.
**docs-impact line**: `docs-impact: none`

### Commit 4
**Prefix**: `[feat]`
**Files to create or modify**:
`src/phases/beat-checks.ts`
`src/phases/drafting.ts`
`docs/current-state.md`
**Summary of the change**: extract a small pure helper module for beat-level issue normalization/formatting, then replace the single adherence-only gate in `drafting.ts` with parallel checks: adherence + ungrounded always, leak only on the Salvatore writer route. Normalize all results into one `BeatIssue[]`, gate retries via OR over blocker issues, and feed one merged targeted-rewrite prompt back to the writer. Keep the existing prior-beat alignment note, but only when an adherence "not enacted" issue exists.
**Verification gates**: all 5 canonical gates.
**Rollback behavior**: standalone on top of commits 1-3; this is the commit that actually changes runtime behavior. No half-wired state after it lands.
**docs-impact line**: update `current-state.md` in this commit

### Commit 5
**Prefix**: `[feat]`
**Files to create or modify**:
`src/phases/beat-checks.test.ts`
`src/models/registry.test.ts`
**Summary of the change**: add pure tests for OR aggregation, severity tagging, retry-context formatting, and finite-cost coverage for the two new W&B artifact URIs. Do not add a full drafting-loop integration test.
**Verification gates**: all 5 canonical gates.
**Rollback behavior**: standalone; test-only.
**docs-impact line**: `docs-impact: none`

### Commit 6
**Prefix**: `[docs]`
**Files to create or modify**:
`docs/todo.md`
`docs/context-engineering.md`
**Summary of the change**: mark the wire-in item complete; keep the production-measurement item open; update context docs so they describe the live two-adapter runtime rather than the earlier v1 placeholder.
**Verification gates**: all 5 canonical gates.
**Rollback behavior**: standalone; docs-only.
**docs-impact line**: `docs-impact: none`

## 3. Agent-directory shape

For `src/agents/halluc-ungrounded/`:
- `index.ts`: export schema/context/prompt; implement `checkHallucUngrounded(prose, beat, outline, characters, worldBible, tags)`.
- `context.ts`: render `BEAT BRIEF`, `WORLD BIBLE (relevant)`, `SPEAKERS`, `PROSE TO CHECK`.
- `schema.ts`: Zod for `{ pass, issues: [{ entity, excerpt }] }`.
- `halluc-ungrounded-system.md`: the narrow grounded-entity rubric from the v3 formatter/eval.

Context fields:
- Beat: `beat.description` as `Summary`, `beat.kind`, `beat.characters`
- Outline: `outline.povCharacter`, `outline.setting`
- World bible: `worldBible.locations[].name`, `worldBible.cultures[].name`, `worldBible.systems[].name`
- Speakers: matching beat-character profiles rendered as `name: speechPattern`
- Exclude `goals`, `avoids`, `traits`, `establishedFacts`, resolved refs, and WB descriptions/rules

For `src/agents/halluc-leak-salvatore/`:
- `index.ts`: export schema/context/prompt; implement `checkHallucLeakSalvatore(prose, tags)`.
- `context.ts`: render only `PROSE:\n...`.
- `schema.ts`: Zod for `{ has_leak, leaks: string[] }`.
- `halluc-leak-salvatore-system.md`: the Salvatore leak-token rubric from the v3 formatter/eval.

## 4. Wire-in shape in drafting.ts

- Put the hallucination fan-out exactly where `checkBeatAdherence()` is called now, immediately after prose generation and before retry accept/reject.
- Run checks in parallel. Use `Promise.all` if the helper wrappers swallow LLM failures into blocking issues; otherwise use `Promise.allSettled` and normalize rejections.
- Aggregate into one local `BeatIssue[]` with `{ source, severity, description }`. All current hallucination hits should be `blocker`; no voting. Beat fails if any blocker exists.
- Retry context should merge all issues into one list. Ungrounded issues should say "remove or ground `<entity>`"; leak issues should say "remove Salvatore leak token `<token>`"; adherence keeps the existing enactment wording.
- Telemetry should rely on `llm_calls.agent = 'halluc-ungrounded'` and `llm_calls.agent = 'halluc-leak-salvatore'`, with the same `{ chapter, beatIndex, attempt }` tags already passed to adherence.

## 5. Roles.ts additions

Insert directly after `adherence-events`:

```ts
  "halluc-ungrounded":         { provider: "wandb", model: "wandb-artifact:///andre14618-/novel-harness/halluc-ungrounded-v2:v1", temperature: 0.1, maxTokens: 512 },
  "halluc-leak-salvatore":     { provider: "wandb", model: "wandb-artifact:///andre14618-/novel-harness/halluc-leak-salvatore-v1:v1", temperature: 0.1, maxTokens: 256 },
```

## 6. Current-state.md update

Apply in commit 4. Replace the vague checker bullets with:

- adherence — `adherence-events` runs inside the beat drafting retry loop.
- hallucination — the beat drafting retry loop now runs `halluc-ungrounded-v2` on every beat and `halluc-leak-salvatore-v1` on Salvatore-routed beats; any fired adapter contributes blocker issues to the same targeted rewrite prompt.

## 7. Tests and gates

Add:
- `src/agents/halluc-ungrounded/context.test.ts`
- `src/agents/halluc-leak-salvatore/context.test.ts`
- `src/phases/beat-checks.test.ts`

Skip:
- Full `drafting.ts` end-to-end test. Justification: the suite is thin, the drafting loop is DB-heavy and transport-heavy, and extracting pure helpers gives enough regression coverage for this wire-in.

Run before every commit:
- `./ui/node_modules/.bin/tsc -p tsconfig.json --noEmit`
- `./ui/node_modules/.bin/tsc -p ui/tsconfig.json --noEmit`
- `bun build --target bun src/index.ts --outfile /tmp/index.js`
- `bun build --target bun src/orchestrator/server.ts --outfile /tmp/orchestrator.js`
- `bun test`

## 8. Post-wire-in measurement plan

1. Query `llm_calls` for `beat-writer`, `adherence-events`, `halluc-ungrounded`, `halluc-leak-salvatore` over the next 5-10 novels.
2. Group by `novel_id, chapter, beat_index, attempt`.
3. Compute per-adapter fire rate and co-fire rate.
4. Split solo `halluc-ungrounded` fires vs solo `halluc-leak-salvatore` fires.
5. Sample accepted beats where only one adapter fired to estimate precision.
6. Measure how often a fired beat gets an immediate retry (`attempt + 1` exists).
7. Measure how often the next attempt clears the same adapter.
8. Confirm `halluc-leak-salvatore` only fires on the Salvatore route.
9. If solo-fire precision is poor, revisit OR vs voting.
10. If repeated retries preserve the same token/entity, tighten retry-context wording before retraining anything.

## 9. Known unknowns

- `docs/commit-conventions.md` does not currently define `[feat]` or `[docs]`; it defines `[roles]` and `[infra]`. The user asked for `[feat]` / `[agent:name]` / `[docs]`; Claude should follow the user's instruction unless told otherwise.
- `src/agents/adherence-events/` does not exist; the real adherence wrapper is `src/agents/writer/adherence-checker.ts`.
- Decide explicitly whether `halluc-leak-salvatore` is gated by `writerPack.label === "salvatore-fantasy"` or by the actual model URI. I recommend gating by writer-pack route.
- If Claude wants stronger retry-loop tests than the pure-helper tests above, that needs a small mock seam first; do not invent a heavy integration harness in this series.

## 10. Execution decisions — 2026-04-18

Recorded here after the series landed (commits `1bf119d` → `93a717b`) so any future Codex session can see what was actually chosen without re-deriving from git log.

| Decision | Outcome | Rationale | Location of evidence |
|---|---|---|---|
| Leak gating: writer-pack label vs model URI | **Writer-pack label** (`writerPack.label === "salvatore-fantasy"`) | The leak check is about the training corpus, which `WRITER_GENRE_PACKS` uniquely identifies; URI gating breaks if the adapter is re-served under a new artifact name or if a sibling pack is trained on Salvatore data. User blessed this in response to Codex's §9 recommendation. | `src/phases/beat-checks.ts` docstring + commit `df2c5f0` |
| Fan-out primitive: `Promise.all` vs `allSettled` | **`Promise.all`** | Every underlying helper already converts transport/schema failures into blocker issues instead of throwing, so there is no rejection path. Future checkers that violate this invariant should trigger a switch to `allSettled` — comment recorded in `beat-checks.ts`. | `src/phases/beat-checks.ts` `runBeatChecks` + commit `df2c5f0` |
| Severity scheme | **All current issues `blocker`; `warning` reserved** | Every v3 adapter emits the same severity today. `BeatIssue.severity` is present in the type so future voting / soft-signal modes can land without a breaking change. Revisit after the production-telemetry runbook gives false-positive data. | `src/phases/beat-checks.ts` type def + `docs/todo.md` §2 |
| Agent `maxTokens` | **512 for ungrounded, 256 for leak** | Ungrounded output is an issues array (each item has entity + excerpt), so needs more headroom. Leak output is a short token list. Both match training-call budgets. | `src/models/roles.ts` comment block + commit `6a8bbba` |
| Config-UI grouping | **Both agents under "Validators"** | Follows the existing pattern (`chapter-plan-checker`, `continuity-*` live there). Makes operator overrides discoverable from the Config page. | `src/orchestrator/novel-routes.ts` + commit `6a8bbba` |
| Phase mapping in telemetry | **Both agents → `"drafting"`** | Matches the existing `adherence-events` mapping; per-adapter cost/latency rolls up under the drafting phase in `llm_calls` summaries. | `src/logger.ts` `getPhaseForAgent` + commit `6a8bbba` |
| Aggregation pureness | **Extracted `aggregateIssues()` as a pure function** | Lets the OR semantics + source tagging + retry-line formatting be unit-tested without an LLM call. `runBeatChecks()` now delegates to it. Covered by 8 tests in `beat-checks.test.ts` + 2 URI-cost tests in `registry.test.ts`. | `src/phases/beat-checks.ts` + commit `f01ff88` |
| Integration test for the full drafting loop | **Skipped (per §7)** | The loop is DB- and transport-heavy; adding mocks for this one wire-in would invent a harness the rest of the suite doesn't have. Pure-helper tests give enough regression coverage. Revisit if future work needs a proper drafting-loop test seam. | This plan §7 + commit `f01ff88` |

### What the next Codex session should know when asked about this subsystem

- Wire-in is complete and live in `drafting.ts` as of commit `df2c5f0`. No separate pilot is scheduled — the next action is a production-telemetry pass over 5–10 novels per §8 of this document.
- `adherence-events` → `halluc-ungrounded` → `halluc-leak-salvatore` is the canonical ordering used in log lines (`summarizeIssues()` in `beat-checks.ts`). If Codex proposes reordering, note that retry-line order shapes which issue the writer sees first in the rewrite prompt.
- The `writer-pack-label` gating is the load-bearing architectural choice. Any future non-Salvatore voice LoRA needs its own paired leak adapter (open item in `docs/todo.md` §1). Per-URI gating is explicitly rejected.
- The unified-aggregator infrastructure is now the home for any new beat-level checker; adding one means writing an agent module under `src/agents/<name>/` and updating `runBeatChecks` + `aggregateIssues` in `src/phases/beat-checks.ts`. No further architectural work required.
