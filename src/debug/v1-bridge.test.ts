/**
 * Unit tests for the V1→V2 debug-injection bridge.
 *
 * Each test resets the V2 store + restores process.env so the assertions
 * are independent. The bridge mutates `process.env.DEBUG_ENABLE_INJECTION`
 * when any V1 force flag is set; the test cleanup must put that back.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { applyV1EnvVarsAsV2Rules } from "./v1-bridge"
import { listInjectionRules, __resetInjectionStoreForTests } from "./injection-store"

const V1_ENV_KEYS = [
  "DEBUG_FORCE_PLAN_CHECK",
  "DEBUG_FORCE_REVISER",
  "DEBUG_FORCE_VALIDATION",
  "DEBUG_ENABLE_INJECTION",
] as const

let savedEnv: Record<(typeof V1_ENV_KEYS)[number], string | undefined>

beforeEach(() => {
  __resetInjectionStoreForTests()
  savedEnv = {
    DEBUG_FORCE_PLAN_CHECK: process.env.DEBUG_FORCE_PLAN_CHECK,
    DEBUG_FORCE_REVISER: process.env.DEBUG_FORCE_REVISER,
    DEBUG_FORCE_VALIDATION: process.env.DEBUG_FORCE_VALIDATION,
    DEBUG_ENABLE_INJECTION: process.env.DEBUG_ENABLE_INJECTION,
  }
  for (const k of V1_ENV_KEYS) delete process.env[k]
})

afterEach(() => {
  for (const k of V1_ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  __resetInjectionStoreForTests()
})

describe("applyV1EnvVarsAsV2Rules — no-op cases", () => {
  it("registers nothing when no V1 env vars are set", () => {
    const report = applyV1EnvVarsAsV2Rules()
    expect(report.translated).toBe(0)
    expect(report.reasons).toEqual([])
    expect(report.enabledMasterGate).toBe(false)
    expect(listInjectionRules()).toHaveLength(0)
  })

  it("ignores DEBUG_FORCE_VALIDATION (out of D4a scope)", () => {
    process.env.DEBUG_FORCE_VALIDATION = "pov"
    const report = applyV1EnvVarsAsV2Rules()
    expect(report.translated).toBe(0)
    expect(listInjectionRules()).toHaveLength(0)
    // Master gate stays off because no D4a-scope flag was set
    expect(report.enabledMasterGate).toBe(false)
  })

  it("treats unrecognized DEBUG_FORCE_PLAN_CHECK values as no-op", () => {
    process.env.DEBUG_FORCE_PLAN_CHECK = "not-a-real-value"
    const report = applyV1EnvVarsAsV2Rules()
    expect(report.translated).toBe(0)
    expect(listInjectionRules()).toHaveLength(0)
  })

  it("treats unrecognized DEBUG_FORCE_REVISER values as no-op", () => {
    process.env.DEBUG_FORCE_REVISER = "explode"
    const report = applyV1EnvVarsAsV2Rules()
    expect(report.translated).toBe(0)
    expect(listInjectionRules()).toHaveLength(0)
  })
})

describe("applyV1EnvVarsAsV2Rules — DEBUG_FORCE_PLAN_CHECK=fail", () => {
  it("registers a force-result rule on chapter-plan-checker", () => {
    process.env.DEBUG_FORCE_PLAN_CHECK = "fail"
    const report = applyV1EnvVarsAsV2Rules()
    expect(report.translated).toBe(1)

    const rules = listInjectionRules()
    expect(rules).toHaveLength(1)
    const rule = rules[0]!
    expect(rule.match.agentName).toBe("chapter-plan-checker")
    expect(rule.action.kind).toBe("force-result")
    if (rule.action.kind === "force-result") {
      const parsed = JSON.parse(rule.action.content)
      expect(parsed.pass).toBe(false)
      expect(Array.isArray(parsed.deviations)).toBe(true)
      expect(parsed.deviations[0].beat_index).toBe(0)
    }
  })

  it("auto-enables DEBUG_ENABLE_INJECTION when previously unset", () => {
    process.env.DEBUG_FORCE_PLAN_CHECK = "fail"
    const report = applyV1EnvVarsAsV2Rules()
    expect(report.enabledMasterGate).toBe(true)
    expect(process.env.DEBUG_ENABLE_INJECTION).toBe("true")
  })

  it("does not flip the auto-enabled flag when DEBUG_ENABLE_INJECTION was already true", () => {
    process.env.DEBUG_FORCE_PLAN_CHECK = "fail"
    process.env.DEBUG_ENABLE_INJECTION = "true"
    const report = applyV1EnvVarsAsV2Rules()
    expect(report.enabledMasterGate).toBe(false)
    expect(process.env.DEBUG_ENABLE_INJECTION).toBe("true")
  })

  it("uses a high exhaustAfter so the rule survives many attempts", () => {
    process.env.DEBUG_FORCE_PLAN_CHECK = "fail"
    applyV1EnvVarsAsV2Rules()
    const rule = listInjectionRules()[0]!
    // RegisteredInjectionRule.exhaustAfter inherits InjectionRule's
    // optional typing, but the store always normalizes the default
    // before persistence — we know it's defined here.
    const exhaust = rule.exhaustAfter ?? 0
    expect(exhaust).toBeGreaterThan(1000)
    expect(rule.remainingMatches).toBe(exhaust)
  })
})

describe("applyV1EnvVarsAsV2Rules — DEBUG_FORCE_REVISER=throw", () => {
  it("registers a force-error rule on chapter-plan-reviser", () => {
    process.env.DEBUG_FORCE_REVISER = "throw"
    const report = applyV1EnvVarsAsV2Rules()
    expect(report.translated).toBe(1)

    const rules = listInjectionRules()
    expect(rules).toHaveLength(1)
    const rule = rules[0]!
    expect(rule.match.agentName).toBe("chapter-plan-reviser")
    expect(rule.action.kind).toBe("force-error")
    if (rule.action.kind === "force-error") {
      expect(rule.action.errorName).toBe("Error")
      expect(rule.action.message).toContain("DEBUG_FORCE_REVISER=throw")
    }
  })
})

describe("applyV1EnvVarsAsV2Rules — DEBUG_FORCE_REVISER=reject", () => {
  it("registers a force-result rule with a 1-scene plan (below floor)", () => {
    process.env.DEBUG_FORCE_REVISER = "reject"
    const report = applyV1EnvVarsAsV2Rules()
    expect(report.translated).toBe(1)

    const rules = listInjectionRules()
    expect(rules).toHaveLength(1)
    const rule = rules[0]!
    expect(rule.match.agentName).toBe("chapter-plan-reviser")
    expect(rule.action.kind).toBe("force-result")
    if (rule.action.kind === "force-result") {
      const parsed = JSON.parse(rule.action.content)
      // 1 scene → triggers reviser-policy scene-count rejection (Math.max(3, ...))
      expect(Array.isArray(parsed.scenes)).toBe(true)
      expect(parsed.scenes).toHaveLength(1)
      expect(parsed.scenes[0].description).toBeDefined()
      // chapterScenePlanSchema requires these fields with default []
      expect(parsed.establishedFacts).toEqual([])
      expect(parsed.characterStateChanges).toEqual([])
      expect(parsed.knowledgeChanges).toEqual([])
    }
  })
})

describe("applyV1EnvVarsAsV2Rules — combined flags", () => {
  it("registers two rules when DEBUG_FORCE_PLAN_CHECK=fail + DEBUG_FORCE_REVISER=reject (R6 setup)", () => {
    process.env.DEBUG_FORCE_PLAN_CHECK = "fail"
    process.env.DEBUG_FORCE_REVISER = "reject"
    const report = applyV1EnvVarsAsV2Rules()
    expect(report.translated).toBe(2)

    const rules = listInjectionRules()
    expect(rules).toHaveLength(2)
    const agents = rules.map(r => r.match.agentName).sort()
    expect(agents).toEqual(["chapter-plan-checker", "chapter-plan-reviser"])
  })

  it("registers one rule for plan-check and one for reviser=throw", () => {
    process.env.DEBUG_FORCE_PLAN_CHECK = "fail"
    process.env.DEBUG_FORCE_REVISER = "throw"
    const report = applyV1EnvVarsAsV2Rules()
    expect(report.translated).toBe(2)

    const rules = listInjectionRules()
    const reviserRule = rules.find(r => r.match.agentName === "chapter-plan-reviser")
    expect(reviserRule?.action.kind).toBe("force-error")
  })

  it("DEBUG_FORCE_REVISER=reject + throw — first match wins (throw shadows reject)", () => {
    // throw is checked first in the if/else-if chain; reject is the
    // else branch. Setting REVISER to "throw" should produce the
    // force-error rule, not force-result. (You can't set both values to
    // a single env var simultaneously, but this asserts the ordering
    // contract.)
    process.env.DEBUG_FORCE_REVISER = "throw"
    applyV1EnvVarsAsV2Rules()
    const rules = listInjectionRules()
    expect(rules).toHaveLength(1)
    expect(rules[0]!.action.kind).toBe("force-error")
  })
})
