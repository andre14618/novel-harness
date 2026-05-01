import { afterEach, expect, test } from "bun:test"
import { z } from "zod"

import { callAgent, executeAndLog } from "./llm"
import { getTransport, setTransport, type LLMRequest, type LLMResponse, type LLMTransport } from "./transport"

const originalTransport = getTransport()

afterEach(() => {
  setTransport(originalTransport)
})

test("callAgent explicitly disables DeepSeek thinking for non-thinking roles", async () => {
  let captured: LLMRequest | null = null
  setTransport(capturingTransport(req => { captured = req }))

  await callAgent({
    provider: "deepseek",
    model: "deepseek-v4-flash",
    thinking: false,
    systemPrompt: "Return JSON.",
    userPrompt: "Return {\"pass\": true}.",
    schema: z.object({ pass: z.boolean() }),
    agentName: "test-agent",
  })

  expect(captured?.extraBody).toEqual({ thinking: { type: "disabled" } })
})

test("callAgent explicitly enables DeepSeek thinking for thinking roles", async () => {
  let captured: LLMRequest | null = null
  setTransport(capturingTransport(req => { captured = req }))

  await callAgent({
    provider: "deepseek",
    model: "deepseek-v4-flash",
    thinking: true,
    systemPrompt: "Return JSON.",
    userPrompt: "Return {\"pass\": true}.",
    schema: z.object({ pass: z.boolean() }),
    agentName: "test-agent",
  })

  expect(captured?.extraBody).toEqual({ thinking: { type: "enabled" } })
})

test("callAgent rejects completion cap hits before JSON parsing", async () => {
  setTransport(responseTransport({
    content: '{"pass": true}',
    usage: { prompt_tokens: 1, completion_tokens: 10, cached_tokens: 0 },
    latencyMs: 1,
    httpAttempts: 1,
    retryErrors: [],
    finishReason: "length",
  }))

  await expect(callAgent({
    provider: "deepseek",
    model: "deepseek-v4-flash",
    thinking: false,
    systemPrompt: "Return JSON.",
    userPrompt: "Return {\"pass\": true}.",
    schema: z.object({ pass: z.boolean() }),
    agentName: "test-agent",
    maxTokens: 10,
  })).rejects.toThrow("hit max token cap")
})

test("executeAndLog rejects cap hits for raw text calls", async () => {
  setTransport(responseTransport({
    content: "truncated prose",
    usage: { prompt_tokens: 1, completion_tokens: 4, cached_tokens: 0 },
    latencyMs: 1,
    httpAttempts: 1,
    retryErrors: [],
  }))

  await expect(executeAndLog({
    provider: "deepseek",
    model: "deepseek-v4-flash",
    temperature: 0.8,
    maxTokens: 4,
    systemPrompt: "Write prose.",
    userPrompt: "Go.",
    responseFormat: { type: "text" },
  }, undefined, "beat-writer")).rejects.toThrow("hit max token cap")
})

function capturingTransport(capture: (request: LLMRequest) => void): LLMTransport {
  return {
    async execute(request: LLMRequest) {
      capture(request)
      return {
        content: '{"pass": true}',
        usage: { prompt_tokens: 1, completion_tokens: 1, cached_tokens: 0 },
        latencyMs: 1,
        httpAttempts: 1,
        retryErrors: [],
      }
    },
  }
}

function responseTransport(response: LLMResponse): LLMTransport {
  return {
    async execute() {
      return response
    },
  }
}
