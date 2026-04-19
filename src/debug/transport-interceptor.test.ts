/**
 * Unit tests for src/debug/transport-interceptor.ts — V2 debug-injection Phase 1.
 *
 * Covers:
 *   - DEBUG_ENABLE_INJECTION=false → interceptor skipped entirely (store never consulted).
 *   - Fail-open: matcher throws → transport proceeds (interceptor returns "none").
 *   - force-result fires at pre-loop, short-circuits (no retry-loop involvement).
 *   - force-error fires at in-loop, returns { kind: "throw", error } with the
 *     specified name/message for the transport's catch block to handle.
 *   - rate-limit fires at in-loop, returns a synthetic Response for the 429 path.
 *   - Insertion-point gating: force-result at in-loop = none; force-error at
 *     pre-loop = none; rate-limit at pre-loop = none.
 *
 * Does not instantiate a real fetch — these are pure interceptor-surface tests.
 * Integration through DirectTransport.execute() is covered by the existing
 * transport tests + (eventually) Phase 1 equivalence tests per the spec.
 */

import { test, expect, beforeEach, afterEach } from "bun:test"

import {
  maybeInterceptTransportCall,
  isDebugInjectionEnabled,
} from "./transport-interceptor"
import {
  registerInjectionRule,
  listInjectionRules,
  __resetInjectionStoreForTests,
} from "./injection-store"

// Save + restore the env gate around every test so tests can toggle freely.
const originalEnv = process.env.DEBUG_ENABLE_INJECTION

beforeEach(() => {
  __resetInjectionStoreForTests()
  process.env.DEBUG_ENABLE_INJECTION = "true"   // enable by default
})

afterEach(() => {
  if (originalEnv === undefined) delete process.env.DEBUG_ENABLE_INJECTION
  else process.env.DEBUG_ENABLE_INJECTION = originalEnv
})

// ── env gating ───────────────────────────────────────────────────────────

test("isDebugInjectionEnabled returns true only when env is exactly 'true'", () => {
  process.env.DEBUG_ENABLE_INJECTION = "true"
  expect(isDebugInjectionEnabled()).toBe(true)
  process.env.DEBUG_ENABLE_INJECTION = "True"
  expect(isDebugInjectionEnabled()).toBe(false)
  process.env.DEBUG_ENABLE_INJECTION = "1"
  expect(isDebugInjectionEnabled()).toBe(false)
  process.env.DEBUG_ENABLE_INJECTION = "false"
  expect(isDebugInjectionEnabled()).toBe(false)
  delete process.env.DEBUG_ENABLE_INJECTION
  expect(isDebugInjectionEnabled()).toBe(false)
})

test("interceptor is a no-op when DEBUG_ENABLE_INJECTION is not 'true'", () => {
  // Register a rule that would otherwise fire.
  registerInjectionRule({
    match: { agentName: "beat-writer" },
    action: { kind: "force-error", message: "would-fire" },
  })
  process.env.DEBUG_ENABLE_INJECTION = "false"
  const result = maybeInterceptTransportCall({ agentName: "beat-writer" }, "in-loop")
  expect(result.kind).toBe("none")
})

test("interceptor is a no-op when debugContext is missing or lacks agentName", () => {
  registerInjectionRule({
    match: { agentName: "beat-writer" },
    action: { kind: "force-error", message: "" },
  })
  expect(maybeInterceptTransportCall(undefined, "in-loop").kind).toBe("none")
  // agentName-less context (defensive — the LLMRequest debugContext has
  // agentName as required, but the transport wrapper routes may drop it).
  expect(maybeInterceptTransportCall({ agentName: "" } as any, "in-loop").kind).toBe("none")
})

// ── force-result (pre-loop) ──────────────────────────────────────────────

test("force-result fires at pre-loop and returns synthetic LLMResponse", () => {
  registerInjectionRule({
    id: "forced",
    match: { agentName: "chapter-plan-checker" },
    action: {
      kind: "force-result",
      content: "{\"pass\":false,\"deviations\":[]}",
      usage: { prompt_tokens: 100, completion_tokens: 20 },
      latencyMs: 42,
    },
  })
  const out = maybeInterceptTransportCall(
    { agentName: "chapter-plan-checker" },
    "pre-loop",
  )
  expect(out.kind).toBe("force-result")
  if (out.kind !== "force-result") throw new Error("unreachable")
  expect(out.response.content).toBe("{\"pass\":false,\"deviations\":[]}")
  expect(out.response.usage.prompt_tokens).toBe(100)
  expect(out.response.usage.completion_tokens).toBe(20)
  expect(out.response.usage.cached_tokens).toBe(0)
  expect(out.response.latencyMs).toBe(42)
  expect(out.response.httpAttempts).toBe(0)
  expect(out.response.retryErrors).toEqual([])
})

test("force-result with no usage field returns zeros", () => {
  registerInjectionRule({
    match: { agentName: "x" },
    action: { kind: "force-result", content: "hi" },
  })
  const out = maybeInterceptTransportCall({ agentName: "x" }, "pre-loop")
  if (out.kind !== "force-result") throw new Error("expected force-result")
  expect(out.response.usage).toEqual({ prompt_tokens: 0, completion_tokens: 0, cached_tokens: 0 })
})

test("force-result DOES NOT fire at in-loop insertion point", () => {
  registerInjectionRule({
    match: { agentName: "x" },
    action: { kind: "force-result", content: "hi" },
  })
  expect(maybeInterceptTransportCall({ agentName: "x" }, "in-loop").kind).toBe("none")
})

test("force-result consumes the rule even though it short-circuited pre-loop", () => {
  registerInjectionRule({
    id: "fr",
    match: { agentName: "x" },
    action: { kind: "force-result", content: "hi" },
    exhaustAfter: 1,
  })
  const first = maybeInterceptTransportCall({ agentName: "x" }, "pre-loop")
  expect(first.kind).toBe("force-result")
  // Consumed — second call sees no rule.
  const second = maybeInterceptTransportCall({ agentName: "x" }, "pre-loop")
  expect(second.kind).toBe("none")
})

// ── force-error (in-loop) ────────────────────────────────────────────────

test("force-error fires at in-loop with the specified error name + message", () => {
  registerInjectionRule({
    match: { agentName: "beat-writer" },
    action: { kind: "force-error", errorName: "TypeError", message: "synthetic fetch failure" },
  })
  const out = maybeInterceptTransportCall({ agentName: "beat-writer" }, "in-loop")
  expect(out.kind).toBe("throw")
  if (out.kind !== "throw") throw new Error("unreachable")
  expect(out.error.name).toBe("TypeError")
  expect(out.error.message).toBe("synthetic fetch failure")
})

test("force-error defaults errorName to 'Error' when omitted", () => {
  registerInjectionRule({
    match: { agentName: "x" },
    action: { kind: "force-error", message: "m" },
  })
  const out = maybeInterceptTransportCall({ agentName: "x" }, "in-loop")
  if (out.kind !== "throw") throw new Error("expected throw")
  expect(out.error.name).toBe("Error")
})

test("force-error DOES NOT fire at pre-loop insertion point", () => {
  registerInjectionRule({
    match: { agentName: "x" },
    action: { kind: "force-error", message: "m" },
  })
  expect(maybeInterceptTransportCall({ agentName: "x" }, "pre-loop").kind).toBe("none")
})

// ── rate-limit (in-loop) ─────────────────────────────────────────────────

test("rate-limit fires at in-loop and returns a synthetic 429 Response", async () => {
  registerInjectionRule({
    match: { agentName: "beat-writer" },
    action: { kind: "rate-limit" },
  })
  const out = maybeInterceptTransportCall({ agentName: "beat-writer" }, "in-loop")
  expect(out.kind).toBe("response")
  if (out.kind !== "response") throw new Error("unreachable")
  expect(out.response.status).toBe(429)
})

test("rate-limit honors retryAfterMs via a Retry-After header (seconds, rounded up)", () => {
  registerInjectionRule({
    match: { agentName: "x" },
    action: { kind: "rate-limit", retryAfterMs: 3_500, message: "try later" },
  })
  const out = maybeInterceptTransportCall({ agentName: "x" }, "in-loop")
  if (out.kind !== "response") throw new Error("expected response")
  // 3500ms rounds up to 4 seconds.
  expect(out.response.headers.get("Retry-After")).toBe("4")
})

test("rate-limit DOES NOT fire at pre-loop insertion point", () => {
  registerInjectionRule({
    match: { agentName: "x" },
    action: { kind: "rate-limit" },
  })
  expect(maybeInterceptTransportCall({ agentName: "x" }, "pre-loop").kind).toBe("none")
})

// ── fail-open: matcher crashes ──────────────────────────────────────────

test("interceptor fails open when applyAction crashes — returns 'none', does not propagate", () => {
  // Register a real rule, then monkey-patch it in-place so the action's
  // `kind` getter throws. The interceptor reads action.kind inside
  // applyAction; the try/catch there swallows the error and returns "none".
  //
  // This simulates a corrupt store / malformed persisted rule without
  // having to mock out the store module entirely.
  registerInjectionRule({
    id: "poison",
    match: { agentName: "x" },
    action: { kind: "force-error", message: "real" },
  })
  // Mutate the stored rule post-registration. listInjectionRules returns
  // a snapshot array, but each element is a reference to the same stored
  // object — mutating here mutates the store's copy too.
  const stored: any = listInjectionRules().find(r => r.id === "poison")
  expect(stored).toBeTruthy()
  Object.defineProperty(stored, "action", {
    get() { throw new Error("boom") },
  })

  // Must not throw — must return "none".
  const out = maybeInterceptTransportCall({ agentName: "x" }, "in-loop")
  expect(out.kind).toBe("none")
})

// ── targeted match with multi-field context ─────────────────────────────

test("full multi-field match: novelId + agentName + chapter + beatIndex + attempt", () => {
  registerInjectionRule({
    id: "narrow",
    match: {
      novelId: "test-retry-1",
      agentName: "beat-writer",
      chapter: 2,
      beatIndex: 5,
      attempt: 1,
    },
    action: { kind: "force-error", message: "narrow fire" },
  })
  const hit = maybeInterceptTransportCall(
    { novelId: "test-retry-1", agentName: "beat-writer", chapter: 2, beatIndex: 5, attempt: 1 },
    "in-loop",
  )
  expect(hit.kind).toBe("throw")
  // Wrong attempt → no match.
  __resetInjectionStoreForTests()
  registerInjectionRule({
    id: "narrow",
    match: { novelId: "test-retry-1", agentName: "beat-writer", chapter: 2, beatIndex: 5, attempt: 1 },
    action: { kind: "force-error", message: "narrow fire" },
  })
  const miss = maybeInterceptTransportCall(
    { novelId: "test-retry-1", agentName: "beat-writer", chapter: 2, beatIndex: 5, attempt: 2 },
    "in-loop",
  )
  expect(miss.kind).toBe("none")
})

test("attempt-as-array matches the settle-loop convergence scenario from spec §4.1", () => {
  registerInjectionRule({
    id: "attempts-1-2",
    match: { agentName: "chapter-plan-checker", chapter: 4, attempt: [1, 2] },
    action: { kind: "force-result", content: "{\"pass\":false}" },
    exhaustAfter: 2,
  })
  // Attempt 1 hits.
  const a1 = maybeInterceptTransportCall(
    { agentName: "chapter-plan-checker", chapter: 4, attempt: 1 },
    "pre-loop",
  )
  expect(a1.kind).toBe("force-result")
  // Attempt 2 hits.
  const a2 = maybeInterceptTransportCall(
    { agentName: "chapter-plan-checker", chapter: 4, attempt: 2 },
    "pre-loop",
  )
  expect(a2.kind).toBe("force-result")
  // Attempt 3 → rule exhausted (exhaustAfter=2 consumed on the two hits).
  const a3 = maybeInterceptTransportCall(
    { agentName: "chapter-plan-checker", chapter: 4, attempt: 3 },
    "pre-loop",
  )
  expect(a3.kind).toBe("none")
})
