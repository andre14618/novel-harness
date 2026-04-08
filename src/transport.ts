/**
 * LLM Transport Layer.
 *
 * Sits beneath all LLM call paths (callAgent, generateProse, judgeDimension).
 * The transport decides HOW to execute. Callers build prompts as usual.
 *
 * Transports:
 *
 * 1. DirectTransport (default)
 *    Standard real-time HTTP calls with retry logic.
 *
 * 2. BatchTransport (LLM_TRANSPORT=batch or --batch flag)
 *    Queues requests in memory, submits as a single batch via provider batch API
 *    (e.g., OpenAI /v1/batches). 50% off, async 24h turnaround. Results collected
 *    later by the orchestrator or manually.
 *
 * Provider prefix caching (OpenAI 90% off, DeepSeek 95% off) happens automatically
 * when prompts share the same prefix — no transport-level intervention needed.
 */

import {
  PROVIDERS, getApiKey, getModel,
  type ProviderName,
} from "../models/registry"
import type { BatchProvider, BatchRequest } from "../benchmark/batch/types"

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
  /** Batch: submit all queued requests. Returns provider batch ID. */
  flush?(): Promise<string>
  /** Number of queued requests (batch mode). */
  queueSize?(): number
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

    // Resolve fine-tune: if the model has baseModel/lora, send baseModel as the API model
    // and include the lora adapter ID as a separate field
    const modelDef = getModel(request.model, request.provider)
    const apiModel = modelDef?.baseModel ?? request.model
    const loraExtra = modelDef?.lora ? { lora: modelDef.lora } : {}
    const reasoningExtra = modelDef?.reasoningEffort ? { reasoning_effort: modelDef.reasoningEffort } : {}

    const providerExtra = providerDef.extraBody ? providerDef.extraBody() : {}

    const body = JSON.stringify({
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
    })
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
        console.log(`  [LLM] ${res.status} — retrying in ${delay / 1000}s (attempt ${attempt + 1}/${maxRetries})...`)
        await Bun.sleep(delay)
        continue
      }

      if (!res.ok) {
        const text = await res.text()
        throw new Error(`LLM request failed: ${res.status} ${text}`)
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

// ── BatchTransport ───────────────────────────────────────────────────────

const EMPTY_RESPONSE: LLMResponse = {
  content: "",
  usage: { prompt_tokens: 0, completion_tokens: 0 },
  latencyMs: 0,
  httpAttempts: 0,
  retryErrors: [],
}

export class BatchTransport implements LLMTransport {
  private queue: Array<{ request: LLMRequest; customId: string }> = []

  constructor(
    private provider: BatchProvider,
    private overrideModel?: string,
  ) {}

  async execute(request: LLMRequest): Promise<LLMResponse> {
    const id = request.customId ?? `${request.callerId ?? "call"}-${this.queue.length}`
    this.queue.push({ request, customId: id })
    return EMPTY_RESPONSE
  }

  queueSize(): number {
    return this.queue.length
  }

  async flush(): Promise<string> {
    if (this.queue.length === 0) throw new Error("BatchTransport: nothing to flush")

    const batchRequests: BatchRequest[] = this.queue.map(q => ({
      customId: q.customId,
      model: this.overrideModel ?? q.request.model,
      messages: [
        { role: "system", content: q.request.systemPrompt },
        { role: "user", content: q.request.userPrompt },
      ],
      temperature: q.request.temperature,
      maxTokens: q.request.maxTokens,
      useMaxCompletionTokens: q.request.useMaxCompletionTokens,
      responseFormat: q.request.responseFormat,
    }))

    return this.provider.submit(batchRequests)
  }

  /** Get queued requests for DB tracking before flush. */
  getQueue(): ReadonlyArray<{ request: LLMRequest; customId: string }> {
    return this.queue
  }
}

// ── Auto-init from env ────────────────────────��──────────────────────────

if (process.env.LLM_TRANSPORT === "batch") {
  console.log("[transport] LLM_TRANSPORT=batch — callers must call setTransport(new BatchTransport(...))")
}
