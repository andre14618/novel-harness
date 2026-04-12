/**
 * LLM Transport Layer.
 *
 * Sits beneath all LLM call paths (callAgent, generateProse).
 * The transport decides HOW to execute. Callers build prompts as usual.
 *
 * DirectTransport: Standard real-time HTTP calls with retry logic.
 *
 * Provider prefix caching (OpenAI 90% off, DeepSeek 95% off) happens automatically
 * when prompts share the same prefix — no transport-level intervention needed.
 */

import {
  PROVIDERS, getApiKey, getModel,
  type ProviderName,
} from "../models/registry"
// ── Types ────────────────────────────────────────────────────────────────

export interface LLMRequest {
  systemPrompt: string
  userPrompt: string
  model: string
  provider: ProviderName
  temperature: number
  maxTokens: number
  responseFormat?: { type: string }
  extraBody?: Record<string, any>
  useMaxCompletionTokens?: boolean
  callerId?: string   // "writer", "penalty-judge", etc.
  customId?: string   // for batch result mapping
  // Streaming — when set, DirectTransport uses the provider's SSE stream and
  // invokes onChunk per content delta. The returned LLMResponse.content is the
  // full accumulated string so callers don't need to care about streaming.
  streaming?: boolean
  onChunk?: (delta: string) => void
}

export interface LLMResponse {
  content: string
  usage: { prompt_tokens: number; completion_tokens: number }
  latencyMs: number
  httpAttempts: number
  retryErrors: Array<{ status: number; delay: number }>
}

export interface LLMTransport {
  execute(request: LLMRequest): Promise<LLMResponse>
}

// ── Singleton ────────────────────────────────────────────────────────────

let active: LLMTransport | null = null

export function getTransport(): LLMTransport {
  if (!active) active = new DirectTransport()
  return active
}

export function setTransport(t: LLMTransport): void {
  active = t
}

// ── DirectTransport ──────────────────────────────────────────────────────

export class DirectTransport implements LLMTransport {
  async execute(request: LLMRequest): Promise<LLMResponse> {
    const providerDef = PROVIDERS[request.provider]
    const apiKey = getApiKey(request.provider)
    const maxRetries = 3
    const retryErrors: Array<{ status: number; delay: number }> = []
    let httpAttempts = 0
    const startTime = performance.now()

    const tokenParam = request.useMaxCompletionTokens
      ? { max_completion_tokens: request.maxTokens }
      : { max_tokens: request.maxTokens }

    // Resolve fine-tune: provider-specific LoRA handling
    // - W&B Inference: LoRA artifact URI goes in the `model` field (not a separate field)
    // - Together AI: separate `lora` field alongside the base model
    const modelDef = getModel(request.model, request.provider)
    const isWandbLora = modelDef?.lora?.startsWith("wandb-artifact:///")
    const apiModel = isWandbLora
      ? modelDef!.lora!                           // W&B: artifact URI IS the model
      : (modelDef?.baseModel ?? request.model)    // Together/others: base model + separate lora
    const loraExtra = (modelDef?.lora && !isWandbLora) ? { lora: modelDef.lora } : {}
    const reasoningExtra = modelDef?.reasoningEffort ? { reasoning_effort: modelDef.reasoningEffort } : {}

    const providerExtra = providerDef.extraBody ? providerDef.extraBody() : {}

    const useStreaming = !!request.streaming
    const bodyObj: Record<string, any> = {
      model: apiModel,
      messages: [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: request.userPrompt },
      ],
      temperature: request.temperature,
      ...tokenParam,
      response_format: request.responseFormat ?? { type: "json_object" },
      ...providerExtra,
      ...loraExtra,
      ...reasoningExtra,
      ...request.extraBody,
    }
    if (useStreaming) {
      bodyObj.stream = true
      bodyObj.stream_options = { include_usage: true }
    }
    const body = JSON.stringify(bodyObj)
    const headers: Record<string, string> = providerDef.authHeader
      ? { [providerDef.authHeader]: apiKey, "Content-Type": "application/json" }
      : { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" }

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      httpAttempts++
      const res = await fetch(providerDef.apiUrl, { method: "POST", headers, body })

      if (res.status === 429 || res.status >= 500) {
        const delay = (attempt + 1) * 5000
        retryErrors.push({ status: res.status, delay })
        if (attempt === maxRetries) {
          const text = await res.text()
          throw new Error(`LLM request failed after ${maxRetries} retries: ${res.status} ${text}`)
        }
        console.log(`  [LLM] ${request.provider}/${apiModel} ${res.status} — retrying in ${delay / 1000}s (attempt ${attempt + 1}/${maxRetries})...`)
        await Bun.sleep(delay)
        continue
      }

      if (!res.ok) {
        const text = await res.text()
        throw new Error(`LLM request failed: ${res.status} ${text}`)
      }

      if (useStreaming) {
        const streamResult = await consumeSSEStream(res, request.onChunk)
        return {
          content: streamResult.content,
          usage: streamResult.usage,
          latencyMs: performance.now() - startTime,
          httpAttempts,
          retryErrors,
        }
      }

      const data = await res.json() as any
      if (data.error) throw new Error(`LLM error: ${JSON.stringify(data.error)}`)
      return {
        content: data.choices[0].message.content,
        usage: data.usage ?? { prompt_tokens: 0, completion_tokens: 0 },
        latencyMs: performance.now() - startTime,
        httpAttempts,
        retryErrors,
      }
    }

    throw new Error("LLM request: unreachable")
  }
}

// ── SSE stream consumer ─────────────────────────────────────────────────
// Parses an OpenAI-compatible chat completion stream (data: {json}\n\n lines).
// Returns accumulated content and final usage. Invokes onChunk per delta so
// the caller can forward tokens to the UI in real time.
async function consumeSSEStream(
  res: Response,
  onChunk?: (delta: string) => void,
): Promise<{ content: string; usage: { prompt_tokens: number; completion_tokens: number } }> {
  if (!res.body) throw new Error("streaming response missing body")
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let content = ""
  let usage = { prompt_tokens: 0, completion_tokens: 0 }

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // Lines are separated by \n\n in SSE. Split but keep trailing partial.
    const parts = buffer.split("\n\n")
    buffer = parts.pop() ?? ""
    for (const part of parts) {
      const line = part.trim()
      if (!line) continue
      if (!line.startsWith("data:")) continue
      const payload = line.slice(5).trim()
      if (payload === "[DONE]") continue
      try {
        const chunk = JSON.parse(payload)
        if (chunk.error) throw new Error(`stream error: ${JSON.stringify(chunk.error)}`)
        const delta: string | undefined = chunk.choices?.[0]?.delta?.content
        if (delta) {
          content += delta
          if (onChunk) {
            try { onChunk(delta) } catch { /* never let UI callbacks break the stream */ }
          }
        }
        if (chunk.usage) {
          usage = {
            prompt_tokens: chunk.usage.prompt_tokens ?? usage.prompt_tokens,
            completion_tokens: chunk.usage.completion_tokens ?? usage.completion_tokens,
          }
        }
      } catch (err) {
        // Swallow parse errors for malformed chunks; the stream may contain
        // provider-specific lines we don't care about.
        if ((err as Error).message?.startsWith("stream error")) throw err
      }
    }
  }

  return { content, usage }
}
