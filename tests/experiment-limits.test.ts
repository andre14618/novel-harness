import { describe, test, expect } from "bun:test"
import { resolveDefaults, checkLimits } from "../src/orchestrator/experiment-limits"

// ── resolveDefaults ─────────────────────────────────────────────────────

describe("resolveDefaults", () => {
  test("returns defaults when no input", () => {
    const limits = resolveDefaults()
    expect(limits.maxIterations).toBe(15)
    expect(limits.maxCostUsd).toBeNull()
    expect(limits.maxConsecutiveFailures).toBe(3)
  })

  test("overrides individual fields", () => {
    const limits = resolveDefaults({ maxIterations: 5, maxCostUsd: 0.50 })
    expect(limits.maxIterations).toBe(5)
    expect(limits.maxCostUsd).toBe(0.50)
    expect(limits.maxConsecutiveFailures).toBe(3)
  })

  test("all fields overridden", () => {
    const limits = resolveDefaults({ maxIterations: 10, maxCostUsd: 2.0, maxConsecutiveFailures: 5 })
    expect(limits.maxIterations).toBe(10)
    expect(limits.maxCostUsd).toBe(2.0)
    expect(limits.maxConsecutiveFailures).toBe(5)
  })
})

// ── checkLimits ─────────────────────────────────────────────────────────

describe("checkLimits", () => {
  const baseLimits = resolveDefaults({ maxIterations: 5, maxCostUsd: 0.50, maxConsecutiveFailures: 3 })

  test("allows when under all limits", () => {
    const result = checkLimits(0.10, 2, 0, baseLimits)
    expect(result.allowed).toBe(true)
    expect(result.reason).toBeUndefined()
  })

  // ── Iteration limit ───────────────────────────────────────────────

  test("stops at max iterations", () => {
    const result = checkLimits(0.10, 5, 0, baseLimits)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("Max iterations")
    expect(result.reason).toContain("5")
  })

  test("stops when iterations exceed max", () => {
    const result = checkLimits(0, 10, 0, baseLimits)
    expect(result.allowed).toBe(false)
  })

  // ── Consecutive failures limit ────────────────────────────────────

  test("stops at max consecutive failures", () => {
    const result = checkLimits(0, 2, 3, baseLimits)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("consecutive failures")
  })

  test("allows when failures below limit", () => {
    const result = checkLimits(0, 2, 2, baseLimits)
    expect(result.allowed).toBe(true)
  })

  // ── Cost cap ──────────────────────────────────────────────────────

  test("stops when cost reaches cap", () => {
    const result = checkLimits(0.55, 2, 0, baseLimits)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("Cost cap")
    expect(result.reason).toContain("$0.50")
  })

  test("stops when cost exactly equals cap", () => {
    const result = checkLimits(0.50, 2, 0, baseLimits)
    expect(result.allowed).toBe(false)
  })

  test("allows when cost just under cap", () => {
    const result = checkLimits(0.499, 2, 0, baseLimits)
    expect(result.allowed).toBe(true)
  })

  // ── No cost cap ───────────────────────────────────────────────────

  test("no cost cap means cost never stops iteration", () => {
    const noCostCapLimits = resolveDefaults({ maxIterations: 100, maxCostUsd: null })
    const result = checkLimits(999.99, 2, 0, noCostCapLimits)
    expect(result.allowed).toBe(true)
  })

  // ── Priority: iteration limit checked before cost ────────��────────

  test("iteration limit takes priority over cost", () => {
    const result = checkLimits(0.55, 5, 0, baseLimits)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("Max iterations")
  })

  test("consecutive failures takes priority over cost", () => {
    const result = checkLimits(0.55, 2, 3, baseLimits)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("consecutive failures")
  })
})
