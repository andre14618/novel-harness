/**
 * LLM Transport Layer.
 *
 * Sits beneath all LLM call paths (callAgent, generateProse, judgeDimension).
 * The transport decides HOW to execute. Callers build prompts as usual.
 *
 * Cost-reduction strategies and their transports:
 *
 * 1. DirectTransport (default)
 *    Standard real-time HTTP calls with retry logic.
 *
 * 2. BatchTransport (LLM_TRANSPORT=batch or --batch flag)
 *    Queues requests in memory, submits as a single batch via provider batch API
 *    (e.g., OpenAI /v1/batches). 50% off, async 24h turnaround. Results collected
 *    later by the orchestrator or manually.
 *
 * 3. PrefixCacheTransport (LLM_TRANSPORT=cache)
 *    Executes calls in real-time but serializes requests that share the same
 *    system prompt. Exploits provider prefix caching (DeepSeek: 95% input
 *    discount, OpenAI: 50% input discount) where consecutive calls with
 *    identical prompt prefixes hit the cache. Parallel calls with different
 *    system prompts are unaffected.
 *
 * Transports are composable — PrefixCacheTransport wraps DirectTransport,
 * and future transports could wrap others (e.g., rate-limited transport).
 */

import {
  PROVIDERS, getApiKey,
  type ProviderName, type CacheStrategy,
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

    const body = JSON.stringify({
      model: request.model,
      messages: [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: request.userPrompt },
      ],
      temperature: request.temperature,
      ...tokenParam,
      response_format: request.responseFormat ?? { type: "json_object" },
      ...request.extraBody,
    })
    const headers = {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    }

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

// ── PrefixCacheTransport ─────────────────────────────────────────────────
// Reads the provider's CacheStrategy from the registry and applies the
// right behavior per-request:
//
//   - "automatic" + benefitsFromSequential: serialize same-prefix calls
//     so the provider's automatic prefix cache sees consecutive identical
//     prefixes. (DeepSeek: 95% input discount, OpenAI: 50% >1024 tokens)
//
//   - "explicit": transform the request to add provider-specific cache
//     markers (e.g., Anthropic cache_control blocks) before sending.
//
//   - "none": pass through directly, no serialization or transformation.
//
// Callers can fire all calls concurrently (Promise.all). The transport
// handles serialization internally — only same-prefix, same-provider
// calls are serialized. Everything else runs in parallel.

export class PrefixCacheTransport implements LLMTransport {
  private inner = new DirectTransport()
  private locks = new Map<string, Promise<void>>()

  private getCacheStrategy(provider: ProviderName): CacheStrategy | undefined {
    return PROVIDERS[provider]?.cache
  }

  async execute(request: LLMRequest): Promise<LLMResponse> {
    const strategy = this.getCacheStrategy(request.provider)

    // No caching support — pass through directly
    if (!strategy || strategy.type === "none") {
      return this.inner.execute(request)
    }

    // Explicit caching — transform request (e.g., add cache_control blocks)
    if (strategy.type === "explicit" && strategy.transformRequest) {
      const messages = [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: request.userPrompt },
      ]
      const transformed = strategy.transformRequest(messages)
      // Pass transformed messages via extraBody override
      const modified: LLMRequest = {
        ...request,
        extraBody: {
          ...request.extraBody,
          _transformedMessages: transformed,
        },
      }
      return this.inner.execute(modified)
    }

    // Automatic caching — serialize if provider benefits from sequential calls
    if (strategy.type === "automatic" && strategy.benefitsFromSequential) {
      return this.executeSequential(request)
    }

    // Automatic but no sequential benefit — just execute
    return this.inner.execute(request)
  }

  private async executeSequential(request: LLMRequest): Promise<LLMResponse> {
    // Group by provider + model + system prompt content.
    // Same group = same prefix = should be serialized for cache hits.
    const prefixKey = `${request.provider}:${request.model}:${request.systemPrompt.length}:${request.systemPrompt.slice(0, 200)}`

    const prev = this.locks.get(prefixKey) ?? Promise.resolve()
    let resolve!: () => void
    const current = new Promise<void>(r => { resolve = r })
    this.locks.set(prefixKey, current)

    try {
      await prev
      return await this.inner.execute(request)
    } finally {
      resolve()
      if (this.locks.get(prefixKey) === current) {
        this.locks.delete(prefixKey)
      }
    }
  }
}

// ── Auto-init from env ───────────────────────────────────────────────────

const envTransport = process.env.LLM_TRANSPORT
if (envTransport === "cache") {
  active = new PrefixCacheTransport()
} else if (envTransport === "batch") {
  // Batch requires explicit setup (provider + model), so just flag it.
  // Callers check process.env.LLM_TRANSPORT and call setTransport() with config.
  console.log("[transport] LLM_TRANSPORT=batch — callers must call setTransport(new BatchTransport(...))")
}
