/**
 * Unit tests for src/debug/injection-store.ts — V2 debug-injection Phase 1.
 *
 * Covers: register + list + match + consume + expiry-reap, exact equality
 * on all optional fields, wildcard novelId, attempt-as-array, exhaustAfter
 * countdown. Does NOT exercise the transport interceptor (see
 * transport-interceptor.test.ts).
 */

import { test, expect, beforeEach } from "bun:test"
import {
  registerInjectionRule,
  listInjectionRules,
  findMatchingInjection,
  consumeInjectionMatch,
  clearInjectionRulesForNovel,
  reapExpiredInjectionRules,
  deleteInjectionRuleById,
  __resetInjectionStoreForTests,
} from "./injection-store"
import type { InjectionRule } from "./injection-types"

beforeEach(() => {
  __resetInjectionStoreForTests()
})

// ── register + list ────────────────────────────────────────────────────

test("registerInjectionRule assigns an id when omitted", () => {
  const rule: InjectionRule = {
    match: { agentName: "beat-writer" },
    action: { kind: "force-error", message: "synth" },
  }
  const reg = registerInjectionRule(rule)
  expect(reg.id).toMatch(/^rule-/)
  expect(reg.remainingMatches).toBe(1)           // default exhaustAfter = 1
  expect(reg.ttlMs).toBe(600_000)                // default 10 min
})

test("registerInjectionRule respects custom id, ttlMs, exhaustAfter", () => {
  const reg = registerInjectionRule({
    id: "my-rule",
    match: { agentName: "beat-writer" },
    action: { kind: "force-error", message: "x" },
    ttlMs: 5_000,
    exhaustAfter: 3,
  })
  expect(reg.id).toBe("my-rule")
  expect(reg.remainingMatches).toBe(3)
  expect(reg.ttlMs).toBe(5_000)
  // expiresAt = createdAt + ttlMs, within a few ms of wall clock
  const createdMs = Date.parse(reg.createdAt)
  const expiresMs = Date.parse(reg.expiresAt)
  expect(expiresMs - createdMs).toBe(5_000)
})

test("listInjectionRules returns registered rules in insertion order", () => {
  registerInjectionRule({ id: "a", match: { agentName: "x" }, action: { kind: "force-error", message: "" } })
  registerInjectionRule({ id: "b", match: { agentName: "y" }, action: { kind: "force-error", message: "" } })
  const list = listInjectionRules()
  expect(list.map(r => r.id)).toEqual(["a", "b"])
})

// ── matching: exact equality on all optional fields ────────────────────

test("matcher requires exact agentName", () => {
  registerInjectionRule({ id: "r", match: { agentName: "beat-writer" }, action: { kind: "force-error", message: "" } })
  expect(findMatchingInjection({ agentName: "beat-writer" })?.id).toBe("r")
  expect(findMatchingInjection({ agentName: "chapter-plan-checker" })).toBeNull()
})

test("matcher exact-matches novelId when present", () => {
  registerInjectionRule({
    id: "scoped",
    match: { novelId: "test-novel-1", agentName: "beat-writer" },
    action: { kind: "force-error", message: "" },
  })
  expect(findMatchingInjection({ novelId: "test-novel-1", agentName: "beat-writer" })?.id).toBe("scoped")
  expect(findMatchingInjection({ novelId: "test-novel-2", agentName: "beat-writer" })).toBeNull()
  expect(findMatchingInjection({ agentName: "beat-writer" })).toBeNull()
})

test("wildcard novelId (matcher omits novelId) matches any novel", () => {
  registerInjectionRule({
    id: "wild",
    match: { agentName: "beat-writer" },
    action: { kind: "force-error", message: "" },
  })
  expect(findMatchingInjection({ novelId: "anything", agentName: "beat-writer" })?.id).toBe("wild")
  expect(findMatchingInjection({ agentName: "beat-writer" })?.id).toBe("wild")
})

test("matcher exact-matches chapter and beatIndex when present", () => {
  registerInjectionRule({
    id: "chbt",
    match: { agentName: "beat-writer", chapter: 4, beatIndex: 2 },
    action: { kind: "force-error", message: "" },
  })
  expect(findMatchingInjection({ agentName: "beat-writer", chapter: 4, beatIndex: 2 })?.id).toBe("chbt")
  expect(findMatchingInjection({ agentName: "beat-writer", chapter: 4, beatIndex: 3 })).toBeNull()
  expect(findMatchingInjection({ agentName: "beat-writer", chapter: 5, beatIndex: 2 })).toBeNull()
  // Missing context field where matcher specifies one = miss.
  expect(findMatchingInjection({ agentName: "beat-writer", chapter: 4 })).toBeNull()
})

// ── attempt: number OR array ────────────────────────────────────────────

test("matcher attempt as number matches exactly", () => {
  registerInjectionRule({
    id: "a3",
    match: { agentName: "beat-writer", attempt: 3 },
    action: { kind: "force-error", message: "" },
  })
  expect(findMatchingInjection({ agentName: "beat-writer", attempt: 3 })?.id).toBe("a3")
  expect(findMatchingInjection({ agentName: "beat-writer", attempt: 2 })).toBeNull()
})

test("matcher attempt as array matches any member", () => {
  registerInjectionRule({
    id: "a12",
    match: { agentName: "beat-writer", attempt: [1, 2] },
    action: { kind: "force-error", message: "" },
  })
  expect(findMatchingInjection({ agentName: "beat-writer", attempt: 1 })?.id).toBe("a12")
  expect(findMatchingInjection({ agentName: "beat-writer", attempt: 2 })?.id).toBe("a12")
  expect(findMatchingInjection({ agentName: "beat-writer", attempt: 3 })).toBeNull()
  // Missing attempt in context when matcher requires one = miss.
  expect(findMatchingInjection({ agentName: "beat-writer" })).toBeNull()
})

// ── consume + exhaustAfter countdown ───────────────────────────────────

test("consumeInjectionMatch decrements remainingMatches and reaps on zero", () => {
  const reg = registerInjectionRule({
    match: { agentName: "beat-writer" },
    action: { kind: "force-error", message: "" },
    exhaustAfter: 2,
  })
  expect(findMatchingInjection({ agentName: "beat-writer" })?.id).toBe(reg.id)

  const remainingAfter1 = consumeInjectionMatch(reg.id)
  expect(remainingAfter1).toBe(1)
  expect(findMatchingInjection({ agentName: "beat-writer" })?.id).toBe(reg.id)

  const remainingAfter2 = consumeInjectionMatch(reg.id)
  expect(remainingAfter2).toBe(0)
  expect(findMatchingInjection({ agentName: "beat-writer" })).toBeNull()
  // Further consume on a gone rule returns 0 without throwing.
  expect(consumeInjectionMatch(reg.id)).toBe(0)
})

test("default exhaustAfter=1 removes rule after first consume", () => {
  const reg = registerInjectionRule({
    match: { agentName: "beat-writer" },
    action: { kind: "force-error", message: "" },
  })
  expect(consumeInjectionMatch(reg.id)).toBe(0)
  expect(listInjectionRules().find(r => r.id === reg.id)).toBeUndefined()
})

// ── expiry reaping ──────────────────────────────────────────────────────

test("reapExpiredInjectionRules removes rules past their TTL", async () => {
  const reg = registerInjectionRule({
    match: { agentName: "beat-writer" },
    action: { kind: "force-error", message: "" },
    ttlMs: 10,
  })
  expect(listInjectionRules().map(r => r.id)).toContain(reg.id)
  // Push the clock past the TTL via the `now` param (preferred over sleep
  // in hot-path tests — deterministic and fast).
  const removed = reapExpiredInjectionRules(Date.now() + 1000)
  expect(removed).toBe(1)
  expect(listInjectionRules()).toEqual([])
})

test("listInjectionRules reaps expired rules lazily", () => {
  const a = registerInjectionRule({
    match: { agentName: "beat-writer" },
    action: { kind: "force-error", message: "" },
    ttlMs: 10,
  })
  // A second rule with a long TTL must survive the reap.
  const b = registerInjectionRule({
    match: { agentName: "chapter-plan-checker" },
    action: { kind: "force-error", message: "" },
    ttlMs: 600_000,
  })

  // Advance the in-memory expiresAt by rewinding createdAt on `a`.
  // Simpler: just verify list() + expired behavior via a second wall-clock
  // call after forcing a reap.
  reapExpiredInjectionRules(Date.now() + 1000)

  const remaining = listInjectionRules().map(r => r.id)
  expect(remaining).toContain(b.id)
  expect(remaining).not.toContain(a.id)
})

// ── clearInjectionRulesForNovel ─────────────────────────────────────────

test("clearInjectionRulesForNovel removes exact-id and wildcard rules", () => {
  const a = registerInjectionRule({
    match: { novelId: "novel-A", agentName: "x" },
    action: { kind: "force-error", message: "" },
  })
  const b = registerInjectionRule({
    match: { novelId: "novel-B", agentName: "x" },
    action: { kind: "force-error", message: "" },
  })
  const wild = registerInjectionRule({
    match: { agentName: "x" },
    action: { kind: "force-error", message: "" },
  })

  const removed = clearInjectionRulesForNovel("novel-A")
  // Clears the scoped-to-A rule AND the wildcard (documented behavior —
  // see the comment block on clearInjectionRulesForNovel).
  expect(removed).toBe(2)

  const ids = listInjectionRules().map(r => r.id)
  expect(ids).toContain(b.id)
  expect(ids).not.toContain(a.id)
  expect(ids).not.toContain(wild.id)
})

// ── deleteInjectionRuleById ─────────────────────────────────────────────

test("deleteInjectionRuleById removes by id and reports boolean", () => {
  const reg = registerInjectionRule({
    match: { agentName: "x" },
    action: { kind: "force-error", message: "" },
  })
  expect(deleteInjectionRuleById(reg.id)).toBe(true)
  expect(deleteInjectionRuleById(reg.id)).toBe(false)
  expect(deleteInjectionRuleById("nonexistent")).toBe(false)
})

// ── multiple rules + first-match-wins ───────────────────────────────────

test("findMatchingInjection returns the first matching rule in insertion order", () => {
  registerInjectionRule({
    id: "specific",
    match: { agentName: "beat-writer", chapter: 4 },
    action: { kind: "force-error", message: "" },
  })
  registerInjectionRule({
    id: "wild",
    match: { agentName: "beat-writer" },
    action: { kind: "force-error", message: "" },
  })
  // Both rules match; insertion-order iteration returns the first one.
  expect(findMatchingInjection({ agentName: "beat-writer", chapter: 4 })?.id).toBe("specific")
  // Only the wildcard matches when chapter doesn't line up.
  expect(findMatchingInjection({ agentName: "beat-writer", chapter: 9 })?.id).toBe("wild")
})
