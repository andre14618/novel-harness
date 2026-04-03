import { describe, test, expect, beforeAll, beforeEach, afterEach, spyOn, mock } from "bun:test"
import { z } from "zod"

// Mock Postgres modules before any imports that touch them
mock.module("../data/connection", () => ({ default: () => [] }))
mock.module("../data/db", () => ({
  logLLMCall: async () => {},
  createRun: async () => 1,
  saveLLMCall: async () => {},
}))

import { extractJSON, callAgent } from "../src/llm"
import { makeLLMResponse } from "./helpers"

beforeAll(() => {
  process.env.OPENROUTER_API_KEY = "test-key-fake"
})

// ── extractJSON ────────────────────────────────────────────────────────────

describe("extractJSON", () => {
  test("returns raw valid JSON string", () => {
    const json = '{"key": "value"}'
    expect(extractJSON(json)).toBe(json)
  })

  test("extracts from ```json code block", () => {
    const raw = 'Here is the result:\n```json\n{"key": "value"}\n```\nDone.'
    expect(JSON.parse(extractJSON(raw))).toEqual({ key: "value" })
  })

  test("extracts from ``` code block without json tag", () => {
    const raw = '```\n{"key": "value"}\n```'
    expect(JSON.parse(extractJSON(raw))).toEqual({ key: "value" })
  })

  test("extracts JSON object from prose", () => {
    const raw = 'Sure! Here is the result: {"key": "value"} hope that helps'
    expect(JSON.parse(extractJSON(raw))).toEqual({ key: "value" })
  })

  test("extracts JSON array from prose", () => {
    const raw = 'The answer is [1, 2, 3] there you go'
    expect(JSON.parse(extractJSON(raw))).toEqual([1, 2, 3])
  })

  test("handles nested objects", () => {
    const raw = 'Result: {"a": {"b": {"c": 1}}} done'
    expect(JSON.parse(extractJSON(raw))).toEqual({ a: { b: { c: 1 } } })
  })

  test("handles reasoning traces before JSON", () => {
    const raw = `Let me think about this step by step.

First, the world needs rules.

Here is my answer:
{"setting": "desert", "rules": ["magic costs vitality"]}`
    const parsed = JSON.parse(extractJSON(raw))
    expect(parsed.setting).toBe("desert")
  })

  test("throws when no JSON found", () => {
    expect(() => extractJSON("no json here at all")).toThrow()
  })

  test("throws on empty string", () => {
    expect(() => extractJSON("")).toThrow()
  })

  test("handles JSON with newlines inside code blocks", () => {
    const raw = '```json\n{\n  "key": "value",\n  "arr": [\n    1,\n    2\n  ]\n}\n```'
    const parsed = JSON.parse(extractJSON(raw))
    expect(parsed.key).toBe("value")
    expect(parsed.arr).toEqual([1, 2])
  })
})

// ── callAgent ──────────────────────────────────────────────────────────────

describe("callAgent", () => {
  const testSchema = z.object({ name: z.string(), count: z.number() })
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test("successful call returns parsed output", async () => {
    globalThis.fetch = async () => makeLLMResponse({ name: "test", count: 42 })

    const result = await callAgent({
      systemPrompt: "You are a test agent.",
      userPrompt: "Give me data.",
      schema: testSchema,
    })

    expect(result.output).toEqual({ name: "test", count: 42 })
    expect(result.tokensUsed.prompt).toBe(100)
    expect(result.tokensUsed.completion).toBe(200)
  })

  test("parses JSON from code blocks", async () => {
    globalThis.fetch = async () => makeLLMResponse('```json\n{"name": "test", "count": 7}\n```')

    const result = await callAgent({
      systemPrompt: "test",
      userPrompt: "test",
      schema: testSchema,
    })

    expect(result.output).toEqual({ name: "test", count: 7 })
  })

  test("throws on Zod validation failure", async () => {
    globalThis.fetch = async () => makeLLMResponse({ name: "test", count: "not a number" })

    await expect(callAgent({
      systemPrompt: "test",
      userPrompt: "test",
      schema: testSchema,
    })).rejects.toThrow("doesn't match schema")
  })

  test("retries on 429", async () => {
    const sleepSpy = spyOn(Bun, "sleep").mockResolvedValue(undefined as any)
    let callCount = 0
    globalThis.fetch = async () => {
      callCount++
      if (callCount === 1) {
        return new Response("rate limited", { status: 429 })
      }
      return makeLLMResponse({ name: "retry", count: 1 })
    }

    const result = await callAgent({
      systemPrompt: "test",
      userPrompt: "test",
      schema: testSchema,
    })

    expect(result.output.name).toBe("retry")
    expect(callCount).toBe(2)
    sleepSpy.mockRestore()
  })

  test("retries on 500", async () => {
    const sleepSpy = spyOn(Bun, "sleep").mockResolvedValue(undefined as any)
    let callCount = 0
    globalThis.fetch = async () => {
      callCount++
      if (callCount === 1) {
        return new Response("server error", { status: 500 })
      }
      return makeLLMResponse({ name: "recovered", count: 2 })
    }

    const result = await callAgent({
      systemPrompt: "test",
      userPrompt: "test",
      schema: testSchema,
    })

    expect(result.output.name).toBe("recovered")
    sleepSpy.mockRestore()
  })

  test("throws on non-retryable error", async () => {
    globalThis.fetch = async () => new Response("Forbidden", { status: 403 })

    await expect(callAgent({
      systemPrompt: "test",
      userPrompt: "test",
      schema: testSchema,
    })).rejects.toThrow("403")
  })

  test("retries with stricter prompt on JSON extraction failure", async () => {
    let callCount = 0
    globalThis.fetch = async () => {
      callCount++
      if (callCount === 1) {
        return makeLLMResponse("This is not JSON at all, just rambling text with no structure whatsoever and nothing useful.")
      }
      return makeLLMResponse({ name: "fixed", count: 3 })
    }

    const result = await callAgent({
      systemPrompt: "test",
      userPrompt: "test",
      schema: testSchema,
    })

    expect(result.output.name).toBe("fixed")
    expect(callCount).toBe(2)
  })

  test("throws LLM error from response body", async () => {
    globalThis.fetch = async () => new Response(
      JSON.stringify({ error: { message: "model overloaded" } }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )

    await expect(callAgent({
      systemPrompt: "test",
      userPrompt: "test",
      schema: testSchema,
    })).rejects.toThrow("model overloaded")
  })
})
