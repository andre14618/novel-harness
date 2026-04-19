/**
 * V2 debug-injection types.
 *
 * See docs/debug-injection-v2-spec.md and Codex review add543640220037e1 for
 * decisions. Phase 1 scope: types + in-memory store + transport interceptor;
 * coexists with the V1 env-flag seams in src/config/debug-injection.ts.
 */

/**
 * Runtime context passed from the wrapper layers (llm.ts) down into the
 * transport so the interceptor can match rules. `agentName` is the only
 * required field — the others are omitted when the caller doesn't know
 * (e.g. concept-phase calls have no chapter/beat).
 */
export type DebugContext = {
  novelId?: string
  agentName: string
  chapter?: number
  beatIndex?: number
  attempt?: number
}

/**
 * Matcher fields on an injection rule. Exact equality on every field that's
 * present; omission = wildcard. `attempt` accepts a single number or an array
 * (matches when the context's attempt is in the array).
 *
 * `novelId` omission = match any novel ("*" wildcard). `agentName` is
 * REQUIRED on every rule so global-error experiments must still pick an
 * agent target.
 */
export type InjectionMatch = {
  novelId?: string            // omitted => wildcard
  agentName: string
  chapter?: number
  beatIndex?: number
  attempt?: number | number[]
}

/**
 * What to do when a rule matches. MVP (Phase 1) supports three kinds:
 *
 *   - force-result: short-circuit BEFORE the first network attempt; return a
 *     synthetic LLMResponse so all downstream logging/tracing finalizers
 *     still run.
 *
 *   - force-error: throw a synthetic Error (name = Error | TypeError |
 *     AbortError) at the pre-fetch boundary. Exercises the existing transport
 *     retry machinery.
 *
 *   - rate-limit: synthesize a Response with the given status (default 429)
 *     and optional Retry-After header. The transport's existing 429 path
 *     handles retry/backoff exactly like a real rate-limit.
 *
 * `delay` is DEFERRED to a later phase — POST requests with `kind: "delay"`
 * are rejected at the HTTP layer.
 */
export type InjectionAction =
  | {
      kind: "force-result"
      content: string
      usage?: {
        prompt_tokens?: number
        completion_tokens?: number
        cached_tokens?: number
      }
      latencyMs?: number
    }
  | {
      kind: "force-error"
      errorName?: "Error" | "TypeError" | "AbortError"
      message: string
    }
  | {
      kind: "rate-limit"
      status?: 429
      message?: string
      retryAfterMs?: number
    }
  | {
      kind: "delay"
      delayMs: number
    }

/**
 * Rule as submitted via POST /api/debug/inject. `id` is auto-generated when
 * omitted. `exhaustAfter` defaults to 1 (fire once then self-remove) and
 * `ttlMs` defaults to 600_000 (10 min).
 */
export interface InjectionRule {
  id?: string
  note?: string
  match: InjectionMatch
  action: InjectionAction
  exhaustAfter?: number       // default 1
  ttlMs?: number              // default 600_000
}

/**
 * Stored form of a rule — adds the generated id, timestamps, and a
 * mutable `remainingMatches` counter the store decrements on each fire.
 */
export interface RegisteredInjectionRule extends InjectionRule {
  id: string
  createdAt: string
  expiresAt: string
  remainingMatches: number
}
