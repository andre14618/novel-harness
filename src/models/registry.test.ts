import { test, expect } from "bun:test"
import { getTokenCost } from "./registry"

test("getTokenCost returns a finite number for providers with cache.type === 'none'", () => {
  const openrouter = getTokenCost("openrouter", "qwen/qwen3-32b", 1000, 500, 0)
  expect(Number.isFinite(openrouter)).toBe(true)
  expect(openrouter).toBeGreaterThan(0)
})

test("getTokenCost returns a finite number for unknown W&B artifact URIs", () => {
  const wandb = getTokenCost(
    "wandb",
    "wandb-artifact:///andre14618-/novel-harness/continuity-v2:v1",
    1000,
    500,
    0,
  )
  expect(Number.isFinite(wandb)).toBe(true)
  expect(wandb).toBeGreaterThan(0)
})

test("getTokenCost still discounts cached tokens for automatic-cache providers", () => {
  const uncached = getTokenCost("groq", "qwen/qwen3-32b", 1000, 500, 0)
  const cached = getTokenCost("groq", "qwen/qwen3-32b", 1000, 500, 1000)
  expect(Number.isFinite(uncached)).toBe(true)
  expect(Number.isFinite(cached)).toBe(true)
  // groq advertises automatic caching with a nonzero discount, so the
  // fully-cached call must cost strictly less than the uncached call.
  expect(cached).toBeLessThan(uncached)
})

test("getTokenCost finite for halluc-ungrounded-v2 W&B artifact URI", () => {
  const cost = getTokenCost(
    "wandb",
    "wandb-artifact:///andre14618-/novel-harness/halluc-ungrounded-v2:v1",
    1000,
    500,
    0,
  )
  expect(Number.isFinite(cost)).toBe(true)
  expect(cost).toBeGreaterThan(0)
})
