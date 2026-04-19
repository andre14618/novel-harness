---
status: design
updated: 2026-04-19
author: Codex gpt-5.4 (agent a892e3f5b4c79a3ea)
---

# V2 Transport-Level Debug Interceptor — Design Spec

**Status:** design only. V1 MVP (env flags + inline seams in `drafting.ts`) is live. V2 replaces the inline seams with a central transport-layer interceptor so injection covers every agent call site automatically, including future refactors. Ready for implementation in a later session.

**Origin:** Codex review thread `a3cb71c15f1be1fb9` recommended this as the durable evolution of the MVP. This spec was drafted by Codex (thread `a892e3f5b4c79a3ea`) and is preserved verbatim below.

## Motivation

V1 fragility: every call site for a target agent must be instrumented separately. Two seam-recheck bugs shipped in this session alone:
- `fed9e4a` — `DEBUG_FORCE_PLAN_CHECK` missed the settle-loop recheck at `drafting.ts:589-626`.
- `4ad2413` — `DEBUG_FORCE_VALIDATION` missed the validation settle-loop recheck at `drafting.ts:889-893`.

Every future refactor of `drafting.ts` risks re-introducing the same class of bug. V2 eliminates the class.

## Section 1: Architecture Shape

The interceptor lives as a pluggable step inside `DirectTransport.execute()` at `src/transport.ts:68`, not in `executeAndLog()` or `callAgent()`. Reasoning: `executeAndLog` reaches transport at `src/llm.ts:287`, while `callAgent()` bypasses it through `makeRequest()` at `src/llm.ts:376` and `:385`. A wrapper-only design recreates V1's problem — one path for prose calls, another for agent calls. The transport is the single converging chokepoint.

Constraint: `LLMRequest` does not currently carry `novelId`, `agentName`, `chapter`, `beatIndex`, or `attempt`. Both wrapper paths must enrich `LLMRequest` with a `debugContext` payload before calling transport. Metadata plumbing, not a second interception layer.

**Matcher registration:** In-memory map keyed first by `novelId` (or `"*"` for global rules), then by `agentName`, with exact-match filtering on optional `chapter`, `beatIndex`, `attempt`.

**State ownership:** New `src/debug/injection-store.ts`. Avoids circular dependency on route code and keeps HTTP layer thin.

**HTTP surface** (inside `handleNovelRoute()` in `novel-routes.ts`):
- `POST /api/debug/inject`
- `GET /api/debug/active`
- `DELETE /api/debug/clear/:novelId`

All three hard-return `404` unless `DEBUG_ENABLE_INJECTION === "true"`. `404` (not `403`) hides the surface entirely on non-test deployments.

**New files:**
- `src/debug/injection-types.ts` — `InjectionRule`, `InjectionMatch`, `InjectionAction`, `DebugContext`, `RegisteredInjectionRule`
- `src/debug/injection-store.ts` — `registerInjectionRule`, `listInjectionRules`, `clearInjectionRulesForNovel`, `findMatchingInjection`, `consumeInjectionMatch`, `reapExpiredInjectionRules`
- `src/debug/transport-interceptor.ts` — `maybeInterceptTransportCall`, `isDebugInjectionEnabled`
- No new route file; branches stay in `novel-routes.ts`

## Section 2: Matcher API

Exact equality on all optional fields; omission = wildcard. No mini-language except `attempt?: number | number[]`.

**MVP action kinds:** `force-result`, `force-error`, `rate-limit`. `delay` deferred.

**Insertion point:** Evaluate rules inside `DirectTransport.execute()` immediately before each provider `fetch()` attempt at `src/transport.ts:123`. Synthetic 429s and thrown errors exercise the existing retry machinery. `force-result` short-circuits before the first network attempt and returns a synthetic `LLMResponse` so the normal logging/tracing finalizers still run.

`exhaustAfter` default `1`; `ttlMs` default `600_000`. Expiry lazy on read/write.

```ts
export type DebugContext = {
  novelId?: string
  agentName: string
  chapter?: number
  beatIndex?: number
  attempt?: number
}

export type InjectionMatch = {
  novelId?: string            // omitted => wildcard
  agentName: string
  chapter?: number
  beatIndex?: number
  attempt?: number | number[]
}

export type InjectionAction =
  | { kind: "force-result"; content: string; usage?: { prompt_tokens?: number; completion_tokens?: number; cached_tokens?: number }; latencyMs?: number }
  | { kind: "force-error"; errorName?: "Error" | "TypeError" | "AbortError"; message: string }
  | { kind: "rate-limit"; status?: 429; message?: string; retryAfterMs?: number }
  | { kind: "delay"; delayMs: number }   // rejected at POST time in MVP

export interface InjectionRule {
  id?: string
  note?: string
  match: InjectionMatch
  action: InjectionAction
  exhaustAfter?: number       // default 1
  ttlMs?: number              // default 600_000
}

export interface RegisteredInjectionRule extends InjectionRule {
  id: string
  createdAt: string
  expiresAt: string
  remainingMatches: number
}
```

## Section 3: Migration Path

**Phase 1:** V2 infrastructure alongside V1 env flags. Both active. V1 inline seams at `drafting.ts:463, 658, 898` remain. Existing 7 tests untouched. New tests cover V2 registration/match/expiry only.

**Phase 2:** Runner opt-in via HTTP API. Campaign harness POSTs rules before starting a run. **UNRESOLVED:** `/api/novel/start` auto-generates `novel-${Date.now()}` IDs at `novel-routes.ts:437`, conflicting with desired `test-*` guard. Fix requires pre-created IDs or a bootstrap route.

Equivalence proof: duplicate the seven V1 tests with V2 registrations for transport-backed seams; keep mixed-mode for the deterministic `validateChapterDraft()` path until it gets its own non-transport plan. Passing: same terminal trace events, same rewrite/reviser behavior, same exhaustion outcomes.

**Phase 3:** Delete V1 env flags + inline seams. Update campaign doc.

## Section 4: Test Surface V2 Enables

### 1. Per-attempt force — settle loop convergence

V1 can't fail attempts 1+2 and pass attempt 3 without bespoke seams. V2:

```json
Rule A: { "match": { "novelId": "test-plan-1", "agentName": "chapter-plan-checker", "chapter": 4, "attempt": [1,2] },
          "action": { "kind": "force-result", "content": "{\"pass\":false,\"deviations\":[{\"description\":\"forced\",\"beat_index\":0}]}" },
          "exhaustAfter": 2 }
Rule B: { "match": { "novelId": "test-plan-1", "agentName": "chapter-plan-checker", "chapter": 4, "attempt": 3 },
          "action": { "kind": "force-result", "content": "{\"pass\":true,\"deviations\":[]}" } }
```

Assert: two failed `plan-check-outcome` traces then pass; no escalation to `chapter-plan-reviser`.

### 2. Provider simulation — transport retry without real network hiccup

```json
{ "match": { "novelId": "test-retry-1", "agentName": "beat-writer", "chapter": 2, "beatIndex": 5, "attempt": 1 },
  "action": { "kind": "force-error", "errorName": "TypeError", "message": "fetch failed (synthetic)" },
  "exhaustAfter": 2 }
```

Interceptor fires at the pre-fetch boundary; first two HTTP attempts inside one `execute()` fail, real third succeeds. Assert `llm_calls.http_attempts >= 3`.

### 3. Multi-agent coordination — exhaustion-handler gate cascade

```json
{ "match": { "novelId": "test-cascade-1", "agentName": "chapter-plan-reviser", "chapter": 6 },
  "action": { "kind": "force-error", "errorName": "Error", "message": "forced reviser throw" } }
```

**UNRESOLVED:** Validation half can't be expressed by a transport-only interceptor because `validateChapterDraft()` is a local function at `drafting.ts:897`, not an LLM call. Phase 1/2 uses mixed-mode: V2 for reviser, V1 env flag for validation.

## Section 5: Risk Matrix

| Risk | Guard |
|---|---|
| Matcher fires on real novel | `DEBUG_ENABLE_INJECTION === "true"` gates ALL route registration AND transport evaluation |
| Non-test novel ID targeted | Reject non-`test-*` IDs on POST (**UNRESOLVED:** conflicts with `novel-${Date.now()}` at `novel-routes.ts:437`) |
| Rules left active across runs | TTL default 10min; `DELETE /api/debug/clear/:novelId`; runner teardown |
| Store growth from leaks | Lazy reap on every register/list/match call; `GET /api/debug/active` returns remaining counts |
| Interceptor crashes during run | Fail open: catch matcher errors, log, ignore rule, continue to real transport |
| Store lost on restart | Acceptable — in-process only; matches V1 MVP behavior |

Fired rules should emit a loud console line with rule ID. **UNRESOLVED:** Attaching rule ID to inspection logs likely requires a small `LLMResponse.debugMeta` extension.

## Section 6: Out of Scope

- **Unit-test mocking with `bun:test` mocks** — this design targets the live orchestrator stack, not isolated function tests.
- **Record/replay** — solves reproducibility by replaying prior traffic; this design solves targeted fault injection.
- **Distributed/multi-process registration** — intentionally in-process, matching existing `activeRuns` model.

## Open design decisions (tracked)

1. `delay` action: ship in Phase 1 or defer entirely? Current recommendation: defer; overlaps with real timeout system.
2. Non-test novel ID guard: how to enforce given auto-generated IDs? Options: (a) pre-created IDs via new route, (b) allow-list regex with test-mode override, (c) per-rule `allowProductionIds: true` override.
3. `LLMResponse.debugMeta` extension for rule-ID attribution in traces. Useful for post-hoc analysis; costs a schema additions.
4. Equivalence criterion: is "same terminal trace events + same outcomes" enough, or do we need byte-level trace equivalence between V1 and V2 runs?
5. Route location: should `/api/debug/*` live in a new `src/orchestrator/debug-routes.ts` file instead of inside `handleNovelRoute()`? The Codex spec leaves this in novel-routes.ts for simplicity but a split file is equally valid.
