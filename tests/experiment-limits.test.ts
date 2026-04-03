import { describe, test, expect, mock } from "bun:test"

// Mock Postgres modules before importing experiment-limits.
// data/connection is imported by data/db via "./connection", which resolves
// relative to data/db.ts. We mock both the test-relative and the db-relative paths.
mock.module("../data/connection", () => ({ default: () => [] }))

let mockCostRows: Array<{ variantLabel: string; totalCost: number; totalCalls: number }> = []

mock.module("../data/db", () => ({
  getExperimentCost: async () => mockCostRows,
  logLLMCall: async () => {},
  createRun: async () => 1,
  saveLLMCall: async () => {},
}))

const { resolveDefaults, checkLimits, getExperimentActualCost } = await import("../src/orchestrator/experiment-limits")

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

// ── getExperimentActualCost ─────────────────────────────────────────────

describe("getExperimentActualCost", () => {
  test("sums costs across variants", async () => {
    mockCostRows = [
      { variantLabel: "baseline", totalCost: 0.012, totalCalls: 5 },
      { variantLabel: "improved-v1", totalCost: 0.008, totalCalls: 3 },
    ]
    const cost = await getExperimentActualCost(1)
    expect(cost).toBeCloseTo(0.02, 4)
  })

  test("returns 0 for empty experiment", async () => {
    mockCostRows = []
    const cost = await getExperimentActualCost(1)
    expect(cost).toBe(0)
  })
})

// ── checkLimits ─────────────────────────────────────────────────────────

describe("checkLimits", () => {
  const baseLimits = resolveDefaults({ maxIterations: 5, maxCostUsd: 0.50, maxConsecutiveFailures: 3 })

  test("allows when under all limits", async () => {
    mockCostRows = [{ variantLabel: "baseline", totalCost: 0.10, totalCalls: 5 }]
    const result = await checkLimits(1, 2, 0, baseLimits)
    expect(result.allowed).toBe(true)
    expect(result.reason).toBeUndefined()
    expect(result.totalCost).toBeCloseTo(0.10, 4)
  })

  // ── Iteration limit ───────────────────────────────────────────────

  test("stops at max iterations", async () => {
    mockCostRows = [{ variantLabel: "baseline", totalCost: 0.10, totalCalls: 5 }]
    const result = await checkLimits(1, 5, 0, baseLimits)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("Max iterations")
    expect(result.reason).toContain("5")
  })

  test("stops when iterations exceed max", async () => {
    mockCostRows = []
    const result = await checkLimits(1, 10, 0, baseLimits)
    expect(result.allowed).toBe(false)
  })

  // ── Consecutive failures limit ────────────────────────────────────

  test("stops at max consecutive failures", async () => {
    mockCostRows = []
    const result = await checkLimits(1, 2, 3, baseLimits)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("consecutive failures")
  })

  test("allows when failures below limit", async () => {
    mockCostRows = []
    const result = await checkLimits(1, 2, 2, baseLimits)
    expect(result.allowed).toBe(true)
  })

  // ── Cost cap ──────────────────────────────────────────────────────

  test("stops when cost reaches cap", async () => {
    mockCostRows = [{ variantLabel: "baseline", totalCost: 0.55, totalCalls: 20 }]
    const result = await checkLimits(1, 2, 0, baseLimits)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("Cost cap")
    expect(result.reason).toContain("$0.50")
  })

  test("stops when cost exactly equals cap", async () => {
    mockCostRows = [{ variantLabel: "baseline", totalCost: 0.50, totalCalls: 15 }]
    const result = await checkLimits(1, 2, 0, baseLimits)
    expect(result.allowed).toBe(false)
  })

  test("allows when cost just under cap", async () => {
    mockCostRows = [{ variantLabel: "baseline", totalCost: 0.499, totalCalls: 15 }]
    const result = await checkLimits(1, 2, 0, baseLimits)
    expect(result.allowed).toBe(true)
  })

  // ── No cost cap ───────────────────────────────────────────────────

  test("no cost cap means cost never stops iteration", async () => {
    const noCostCapLimits = resolveDefaults({ maxIterations: 100, maxCostUsd: null })
    mockCostRows = [{ variantLabel: "baseline", totalCost: 999.99, totalCalls: 5000 }]
    const result = await checkLimits(1, 2, 0, noCostCapLimits)
    expect(result.allowed).toBe(true)
    expect(result.totalCost).toBeCloseTo(999.99, 2)
  })

  // ── Priority: iteration limit checked before cost ─────────────────

  test("iteration limit takes priority over cost", async () => {
    mockCostRows = [{ variantLabel: "baseline", totalCost: 0.55, totalCalls: 20 }]
    const result = await checkLimits(1, 5, 0, baseLimits)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("Max iterations")
  })

  test("consecutive failures takes priority over cost", async () => {
    mockCostRows = [{ variantLabel: "baseline", totalCost: 0.55, totalCalls: 20 }]
    const result = await checkLimits(1, 2, 3, baseLimits)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("consecutive failures")
  })
})
