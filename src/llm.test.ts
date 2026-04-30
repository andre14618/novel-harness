import { afterEach, expect, test } from "bun:test"
import { z } from "zod"

import { callAgent } from "./llm"
import { getTransport, setTransport, type LLMRequest, type LLMTransport } from "./transport"

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
