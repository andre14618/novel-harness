/**
 * V2 debug-injection: transport-level interceptor.
 *
 * Called from inside DirectTransport.execute() at two points:
 *   1. ONCE before the fetch-attempt loop, to short-circuit `force-result`
 *      rules with a synthetic LLMResponse (no retry-loop involvement).
 *   2. ONCE per attempt inside the fetch-attempt loop, to throw a synthetic
 *      error (`force-error`) or return a synthetic 429-style Response
 *      (`rate-limit`). Those actions are retriable by the existing machinery.
 *
 * Fail-open: any exception thrown during matcher evaluation is swallowed and
 * logged; the transport proceeds with the real fetch. The live orchestrator
 * must never crash because of a buggy debug rule.
 *
 * All behavior is gated on `DEBUG_ENABLE_INJECTION === "true"`. When unset or
 * any other value, the hook is a no-op (does not even touch the store).
 */

import {
  findMatchingInjection,
  consumeInjectionMatch,
} from "./injection-store"
import type {
  DebugContext,
  InjectionAction,
  RegisteredInjectionRule,
} from "./injection-types"
import type { LLMResponse } from "../transport"

/**
 * Single env-check so the transport hook never races on process.env
 * reads and the three HTTP routes use the same predicate.
 */
export function isDebugInjectionEnabled(): boolean {
  return process.env.DEBUG_ENABLE_INJECTION === "true"
}

/**
 * Result of an interception attempt. Callers check `kind` and branch:
 *
 *   - "none":         no match (or disabled, or matcher crashed). Proceed with
 *                     the real fetch as normal.
 *   - "force-result": use `response` as the synthetic LLMResponse and return
 *                     it from execute() — skip all network + retry machinery.
 *   - "throw":        throw `error` from the current attempt so the existing
 *                     retry loop handles it exactly like a real network error.
 *   - "response":     treat `response` as if the fetch returned it. The transport's
 *                     existing 429 / 5xx branch handles retry/backoff. Used for
 *                     `rate-limit` actions.
 */
export type InterceptionResult =
  | { kind: "none" }
  | { kind: "force-result"; response: LLMResponse }
  | { kind: "throw"; error: Error }
  | { kind: "response"; response: Response }

/**
 * Where in the transport is the hook being invoked? This controls which
 * action kinds are honored.
 *
 *   - "pre-loop": before the very first fetch attempt. Only `force-result`
 *                 fires here — it needs to short-circuit BEFORE the retry
 *                 loop so there's no wasted attempt count.
 *
 *   - "in-loop":  inside the fetch-attempt loop. `force-error` and `rate-limit`
 *                 fire here because they want to exercise the retry machinery
 *                 (synthetic 429 triggers backoff + retry; thrown error loops
 *                 the same way a real `fetch failed` would).
 */
export type InterceptionPoint = "pre-loop" | "in-loop"

/**
 * Main hook. Returns { kind: "none" } when disabled, when no rule matches,
 * when the matcher crashes, or when the action is not applicable at the
 * given insertion point.
 */
export function maybeInterceptTransportCall(
  debugContext: DebugContext | undefined,
  insertionPoint: InterceptionPoint,
): InterceptionResult {
  // Gate: global env flag. Cheap predicate, checked on every call.
  if (!isDebugInjectionEnabled()) return { kind: "none" }

  // Metadata plumbing gate: V1 callers without a debugContext can't be
  // targeted. Not an error — two of the four execute() sites (the
  // conversationalist chat and artifact-adjuster in novel-routes.ts)
  // don't go through callAgent/executeAndLog and have no context.
  if (!debugContext || !debugContext.agentName) return { kind: "none" }

  let rule: RegisteredInjectionRule | null = null
  try {
    rule = findMatchingInjection(debugContext)
  } catch (err) {
    // Fail-open: a corrupt store must never crash the transport.
    console.warn(
      `[debug-inject] matcher error for agent=${debugContext.agentName} novelId=${debugContext.novelId ?? "-"}: ${formatError(err)}`,
    )
    return { kind: "none" }
  }

  if (!rule) return { kind: "none" }

  try {
    return applyAction(rule, insertionPoint)
  } catch (err) {
    console.warn(
      `[debug-inject] apply-action error ruleId=${rule.id} agent=${debugContext.agentName}: ${formatError(err)}`,
    )
    return { kind: "none" }
  }
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Decide what to do given a matched rule and the insertion point we were
 * called from. Consumes (decrements) the rule's counter when the action
 * actually fires, and emits the `[debug-inject][FIRED]` telemetry line.
 */
function applyAction(
  rule: RegisteredInjectionRule,
  insertionPoint: InterceptionPoint,
): InterceptionResult {
  const action = rule.action

  // `delay` is rejected at the POST layer but guard here too in case a
  // rule ever leaks past the route validator (e.g. if we relax the POST
  // validator in Phase 2).
  if (action.kind === "delay") return { kind: "none" }

  // force-result ONLY fires at the pre-loop boundary — there is no point in
  // intercepting a partially-attempted fetch with a canned LLMResponse.
  if (action.kind === "force-result" && insertionPoint !== "pre-loop") {
    return { kind: "none" }
  }

  // force-error and rate-limit ONLY fire in the loop so the retry machinery
  // engages exactly the way it would for a real provider fault.
  if (action.kind !== "force-result" && insertionPoint !== "in-loop") {
    return { kind: "none" }
  }

  // Fire. Consume the counter BEFORE returning so duplicate invocations
  // (e.g. retry that re-enters the loop) see the updated count. Emit the
  // FIRED log after consumption so the log reflects the new remainingMatches.
  const before = rule.remainingMatches
  consumeInjectionMatch(rule.id)
  const after = Math.max(0, before - 1)

  const novelTag = rule.match.novelId ?? "*"
  console.log(
    `[debug-inject][FIRED] ruleId=${rule.id} agentName=${rule.match.agentName} novelId=${novelTag} kind=${action.kind} remainingMatches=${after}`,
  )

  return buildResult(action)
}

/**
 * Build the InterceptionResult payload for each supported action. Split
 * out to keep `applyAction` focused on gating.
 */
function buildResult(action: InjectionAction): InterceptionResult {
  switch (action.kind) {
    case "force-result": {
      const usage = action.usage ?? {}
      const response: LLMResponse = {
        content: action.content,
        usage: {
          prompt_tokens: usage.prompt_tokens ?? 0,
          completion_tokens: usage.completion_tokens ?? 0,
          cached_tokens: usage.cached_tokens ?? 0,
        },
        latencyMs: action.latencyMs ?? 0,
        httpAttempts: 0,
        retryErrors: [],
      }
      return { kind: "force-result", response }
    }
    case "force-error": {
      const name = action.errorName ?? "Error"
      const error = new Error(action.message)
      // `name` drives downstream branching in the transport (AbortError
      // goes through the timeout cap path). Writable on plain Error.
      error.name = name
      return { kind: "throw", error }
    }
    case "rate-limit": {
      const status = action.status ?? 429
      const body = action.message ?? "rate limited (synthetic debug-inject)"
      const headers: Record<string, string> = { "Content-Type": "text/plain" }
      if (action.retryAfterMs !== undefined) {
        // Retry-After header is in SECONDS per HTTP spec. Round up so
        // "500 ms" becomes "1 s" (matches real provider semantics).
        headers["Retry-After"] = String(Math.ceil(action.retryAfterMs / 1000))
      }
      const response = new Response(body, { status, headers })
      return { kind: "response", response }
    }
    case "delay":
      // Unreachable — gated out above — but TS wants the case so the
      // discriminated-union switch is exhaustive.
      return { kind: "none" }
  }
}
