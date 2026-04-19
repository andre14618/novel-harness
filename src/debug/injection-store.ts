/**
 * In-memory store for V2 debug-injection rules.
 *
 * State ownership: this module. The HTTP routes in novel-routes.ts and the
 * transport interceptor in transport-interceptor.ts both read/write here.
 * Keeping the store separate avoids a circular dependency between routes
 * and transport.
 *
 * Lifetime: process-local, non-persistent. Matches the existing `activeRuns`
 * model in novel-routes.ts — V2 state is acceptable to lose on restart.
 *
 * Lazy expiry: every public operation (register, list, find, clear) calls
 * `reapExpiredInjectionRules()` first, so there's no background timer.
 */

import type {
  InjectionRule,
  RegisteredInjectionRule,
  DebugContext,
  InjectionMatch,
} from "./injection-types"

const DEFAULT_TTL_MS = 600_000          // 10 minutes
const DEFAULT_EXHAUST_AFTER = 1

// ── Internal state ───────────────────────────────────────────────────────

// Keyed by rule id for O(1) lookup on clear-by-id. Iteration order is
// insertion order (Map semantics), so findMatchingInjection walks rules
// in registration order.
const rulesById = new Map<string, RegisteredInjectionRule>()

// Monotonically increasing counter for auto-generated ids. Combined with
// Date.now() for uniqueness across restarts — not cryptographic, just
// unique within a process lifetime.
let nextRuleCounter = 1

function generateRuleId(): string {
  const n = nextRuleCounter++
  return `rule-${Date.now()}-${n}`
}

// ── Expiry ────────────────────────────────────────────────────────────────

/**
 * Remove every expired rule. Called implicitly from every other public
 * operation — callers should not normally invoke it directly.
 */
export function reapExpiredInjectionRules(now: number = Date.now()): number {
  let removed = 0
  for (const [id, rule] of rulesById) {
    if (Date.parse(rule.expiresAt) <= now) {
      rulesById.delete(id)
      removed++
    }
  }
  return removed
}

// ── Registration / listing / clearing ───────────────────────────────────

/**
 * Register a rule. Generates an id if not provided, normalizes defaults
 * (ttlMs, exhaustAfter), and returns the stored rule.
 */
export function registerInjectionRule(rule: InjectionRule): RegisteredInjectionRule {
  reapExpiredInjectionRules()

  const ttlMs = rule.ttlMs ?? DEFAULT_TTL_MS
  const exhaustAfter = rule.exhaustAfter ?? DEFAULT_EXHAUST_AFTER
  const id = rule.id ?? generateRuleId()

  const now = Date.now()
  const registered: RegisteredInjectionRule = {
    ...rule,
    id,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
    remainingMatches: exhaustAfter,
    exhaustAfter,
    ttlMs,
  }

  rulesById.set(id, registered)
  return registered
}

/**
 * Return every currently-active rule. Expired rules are reaped first so
 * the list reflects real state.
 */
export function listInjectionRules(): RegisteredInjectionRule[] {
  reapExpiredInjectionRules()
  return [...rulesById.values()]
}

/**
 * Remove every rule whose matcher targets `novelId` (exact match OR wildcard).
 * Returns the count removed. Use DELETE /api/debug/clear/:novelId.
 *
 * Wildcard rules (no novelId in the matcher) are ALSO removed — the caller
 * presumably wants a full cleanup for a test novel and would be surprised
 * by a cross-novel leak. If this turns out to be wrong, split into
 * `clearInjectionRulesForNovel` (exact) and `clearAllInjectionRules`.
 */
export function clearInjectionRulesForNovel(novelId: string): number {
  reapExpiredInjectionRules()
  let removed = 0
  for (const [id, rule] of rulesById) {
    const matcherNovel = rule.match.novelId
    if (matcherNovel === novelId || matcherNovel === undefined) {
      rulesById.delete(id)
      removed++
    }
  }
  return removed
}

/**
 * Remove a single rule by id. Returns true when something was removed.
 * Exposed for test teardown and future ops tooling — not currently wired
 * to an HTTP route.
 */
export function deleteInjectionRuleById(id: string): boolean {
  reapExpiredInjectionRules()
  return rulesById.delete(id)
}

// ── Matching ─────────────────────────────────────────────────────────────

/**
 * Does a matcher's field match the runtime context field? `undefined` on
 * the matcher always wins (wildcard). For `attempt`, the matcher may be
 * a number or an array-of-numbers.
 */
function fieldMatches<T>(matcher: T | undefined, actual: T | undefined): boolean {
  if (matcher === undefined) return true
  // A required matcher field against a missing context field is a miss —
  // the rule targeted something the caller doesn't know about.
  if (actual === undefined) return false
  return matcher === actual
}

function attemptMatches(
  matcher: InjectionMatch["attempt"],
  actual: number | undefined,
): boolean {
  if (matcher === undefined) return true
  if (actual === undefined) return false
  if (Array.isArray(matcher)) return matcher.includes(actual)
  return matcher === actual
}

function matcherMatchesContext(matcher: InjectionMatch, ctx: DebugContext): boolean {
  // agentName is REQUIRED on every rule — no wildcard path here.
  if (matcher.agentName !== ctx.agentName) return false
  // novelId: undefined on the matcher means "any novel".
  if (!fieldMatches(matcher.novelId, ctx.novelId)) return false
  if (!fieldMatches(matcher.chapter, ctx.chapter)) return false
  if (!fieldMatches(matcher.beatIndex, ctx.beatIndex)) return false
  if (!attemptMatches(matcher.attempt, ctx.attempt)) return false
  return true
}

/**
 * Find the first matching rule for `ctx` (iteration order = registration
 * order). Expired rules are reaped first. Returns the rule itself — the
 * caller is responsible for calling `consumeInjectionMatch(rule.id)` after
 * actually firing, so a find-only operation (e.g. `GET /active` diagnostics)
 * doesn't decrement counters.
 */
export function findMatchingInjection(ctx: DebugContext): RegisteredInjectionRule | null {
  reapExpiredInjectionRules()
  for (const rule of rulesById.values()) {
    if (matcherMatchesContext(rule.match, ctx)) return rule
  }
  return null
}

/**
 * Decrement `remainingMatches` on the given rule; remove when it reaches 0.
 * Returns the new counter (or 0 if removed / not found). Call this IMMEDIATELY
 * after acting on a match — the transport interceptor does so.
 */
export function consumeInjectionMatch(ruleId: string): number {
  const rule = rulesById.get(ruleId)
  if (!rule) return 0
  rule.remainingMatches = Math.max(0, rule.remainingMatches - 1)
  if (rule.remainingMatches === 0) {
    rulesById.delete(ruleId)
    return 0
  }
  return rule.remainingMatches
}

// ── Test helpers ─────────────────────────────────────────────────────────

/**
 * Reset ALL state. Test-only — not exported through any production path.
 */
export function __resetInjectionStoreForTests(): void {
  rulesById.clear()
  nextRuleCounter = 1
}
