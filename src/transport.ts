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
} from "./models/registry"
import { maybeInterceptTransportCall } from "./debug/transport-interceptor"
import type { DebugContext } from "./debug/injection-types"
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
  // V2 debug-injection metadata. Enriched at the wrapper layer (llm.ts) so
  // the transport-level interceptor can match rules without re-deriving
  // agent/novel context from callerId or the provider body. Optional —
  // callers that bypass the wrapper (the conversationalist chat and
  // artifact-adjuster routes) pass no debugContext, and the interceptor
  // treats that as "no match."
  debugContext?: DebugContext
}

export interface LLMResponse {
  content: string
  // cached_tokens is a SUBSET of prompt_tokens — the portion that hit the
  // provider's automatic prefix cache. 0 when unreported or on the first call
  // with a given prefix.
  usage: { prompt_tokens: number; completion_tokens: number; cached_tokens: number }
  latencyMs: number
  httpAttempts: number
  retryErrors: Array<{ status: number; delay: number; error?: string }>
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

    // V2 debug-injection: pre-loop interception. Only `force-result` fires
    // here — it short-circuits BEFORE the first fetch attempt so the test
    // rule doesn't consume a retry budget. Fail-open: if the interceptor
    // crashes, treat it as "no match" and proceed to the fetch loop.
    const preLoop = maybeInterceptTransportCall(request.debugContext, "pre-loop")
    if (preLoop.kind === "force-result") {
      // Match the normal success-path return shape: stamp latencyMs from
      // the wall clock so downstream logging sees a non-zero value even
      // when the action doesn't specify one.
      const synthetic = preLoop.response
      return {
        ...synthetic,
        latencyMs: synthetic.latencyMs || (performance.now() - startTime),
      }
    }

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

    // Q4: Timeout/abort retries are capped separately to prevent worst-case blow-out.
    // maxRetries=3 → 4 attempts × 5min timeout = 20min+; cap timeout retries at 2
    // total attempts (1 retry) to keep worst-case ~10min for genuinely-hung calls.
    let timeoutAttempts = 0

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      httpAttempts++
      // Bound every outbound LLM fetch. Without a timeout, a silently-dropped
      // provider connection (DeepSeek in particular) leaves the fetch hanging
      // forever because there's no EOF to close the response. 5min is well
      // above the p99 (world-builder max is ~120s) so legitimate slow calls
      // still complete; unbound the cap via LLM_REQUEST_TIMEOUT_MS env for
      // very-large-output adapters if needed.
      const timeoutMs = parseInt(process.env.LLM_REQUEST_TIMEOUT_MS ?? "300000", 10)
      const controller = new AbortController()
      // Q8: Emit a log line immediately when the timeout fires so it is visible
      // in journalctl/stdout, not just in the llm_calls row post-hoc.
      const agentTag = request.callerId ? ` agent=${request.callerId}` : ""
      const timer = setTimeout(() => {
        console.log(`  [LLM] TIMEOUT: ${request.provider}/${apiModel}${agentTag} after ${timeoutMs}ms (attempt ${attempt + 1}/${maxRetries + 1})`)
        controller.abort(new Error(`LLM fetch timeout after ${timeoutMs}ms`))
      }, timeoutMs)

      // Q2: Wrap fetch in try/catch so AbortError and network errors (TypeError
      // "fetch failed") flow through the retry loop instead of propagating out
      // immediately. The original code called clearTimeout only in `finally` but
      // the error still escaped before the 429/5xx guard — so "flow through the
      // retry loop" was false. This fixes that.
      let res: Response
      try {
        // V2 debug-injection: in-loop interception. Only `force-error` and
        // `rate-limit` fire here — they're designed to exercise the retry
        // machinery exactly like a real provider fault. `force-error` throws
        // (goes into the catch below → retry or give up based on attempt
        // count and timeoutAttempts); `rate-limit` returns a synthetic
        // Response that the 429/5xx branch below will treat like a real 429.
        // Fail-open: matcher errors are swallowed inside the interceptor.
        const inLoop = maybeInterceptTransportCall(request.debugContext, "in-loop")
        if (inLoop.kind === "throw") {
          throw inLoop.error
        }
        if (inLoop.kind === "response") {
          res = inLoop.response
        } else {
          res = await fetch(providerDef.apiUrl, { method: "POST", headers, body, signal: controller.signal })
        }
      } catch (err) {
        clearTimeout(timer)
        const isAbort = err instanceof Error && (err.name === "AbortError" || /abort/i.test(err.message))
        const delay = (attempt + 1) * 5000
        retryErrors.push({ status: 0, delay, error: err instanceof Error ? err.message : String(err) })
        // Q4: Abort/timeout errors have their own cap (2 total attempts = 1 retry).
        if (isAbort) timeoutAttempts++
        if (attempt === maxRetries || (isAbort && timeoutAttempts > 1)) {
          throw new Error(`LLM request failed after ${attempt + 1} attempt(s): ${err instanceof Error ? err.message : String(err)}`)
        }
        console.log(`  [LLM] ${request.provider}/${apiModel} ${isAbort ? "timeout" : "network error"} — retrying in ${delay / 1000}s (attempt ${attempt + 1}/${maxRetries + 1}): ${err instanceof Error ? err.message : err}`)
        await Bun.sleep(delay)
        continue
      } finally {
        // Always clear the fetch-level timer; for the catch path we already
        // cleared above, but clearTimeout is idempotent so the double-call here
        // is safe (catch path hit both, success path hits only this one).
        clearTimeout(timer)
      }

      if (res.status === 429 || res.status >= 500) {
        const delay = (attempt + 1) * 5000
        retryErrors.push({ status: res.status, delay })
        if (attempt === maxRetries) {
          const text = await res.text()
          throw new Error(`LLM request failed after ${maxRetries + 1} attempts: ${res.status} ${text}`)
        }
        console.log(`  [LLM] ${request.provider}/${apiModel} ${res.status} — retrying in ${delay / 1000}s (attempt ${attempt + 1}/${maxRetries + 1})...`)
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
        usage: extractUsage(data.usage),
        latencyMs: performance.now() - startTime,
        httpAttempts,
        retryErrors,
      }
    }

    throw new Error("LLM request: unreachable")
  }
}

// Normalize the OpenAI-compatible `usage` field. Providers expose cached-token
// counts in slightly different shapes:
//   - OpenAI, DeepSeek, MiniMax, Zai: `prompt_tokens_details.cached_tokens`
//   - DeepSeek also exposes: `prompt_cache_hit_tokens` (legacy alias)
// cached_tokens is always a SUBSET of prompt_tokens, never additive.
function extractUsage(raw: any): { prompt_tokens: number; completion_tokens: number; cached_tokens: number } {
  const prompt_tokens = raw?.prompt_tokens ?? 0
  const completion_tokens = raw?.completion_tokens ?? 0
  const cached_tokens =
    raw?.prompt_tokens_details?.cached_tokens
    ?? raw?.prompt_cache_hit_tokens
    ?? 0
  return { prompt_tokens, completion_tokens, cached_tokens }
}

// ── SSE stream consumer ─────────────────────────────────────────────────
// Parses an OpenAI-compatible chat completion stream (data: {json}\n\n lines).
// Returns accumulated content and final usage. Invokes onChunk per delta so
// the caller can forward tokens to the UI in real time.
//
// Q5: Each reader.read() is raced against a per-chunk idle timeout (default
// 60 s, overridable via LLM_STREAM_IDLE_TIMEOUT_MS). The outer fetch timeout
// is cleared before consumeSSEStream runs, so a mid-stream silent stall —
// server accepts the connection, sends headers, then stops writing tokens —
// would otherwise hang forever. The idle timer resets on every received chunk
// because we re-enter the loop and re-arm.
async function consumeSSEStream(
  res: Response,
  onChunk?: (delta: string) => void,
): Promise<{ content: string; usage: { prompt_tokens: number; completion_tokens: number; cached_tokens: number } }> {
  if (!res.body) throw new Error("streaming response missing body")
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let content = ""
  let usage = { prompt_tokens: 0, completion_tokens: 0, cached_tokens: 0 }
  const chunkIdleTimeoutMs = parseInt(process.env.LLM_STREAM_IDLE_TIMEOUT_MS ?? "60000", 10)

  try {
    while (true) {
      // Race the body read against an idle timeout. Re-armed every iteration so
      // each received chunk resets the clock.
      let idleTimer: ReturnType<typeof setTimeout> | null = null
      const readPromise = reader.read()
      const timeoutPromise = new Promise<never>((_, reject) => {
        idleTimer = setTimeout(
          () => reject(new Error(`SSE chunk idle timeout after ${chunkIdleTimeoutMs}ms`)),
          chunkIdleTimeoutMs,
        )
      })

      let chunk: ReadableStreamReadResult<Uint8Array>
      try {
        chunk = await Promise.race([readPromise, timeoutPromise]) as ReadableStreamReadResult<Uint8Array>
      } finally {
        if (idleTimer !== null) clearTimeout(idleTimer)
      }

      if (chunk.done) break
      buffer += decoder.decode(chunk.value, { stream: true })

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
          const parsed = JSON.parse(payload)
          if (parsed.error) throw new Error(`stream error: ${JSON.stringify(parsed.error)}`)
          const delta: string | undefined = parsed.choices?.[0]?.delta?.content
          if (delta) {
            content += delta
            if (onChunk) {
              try { onChunk(delta) } catch { /* never let UI callbacks break the stream */ }
            }
          }
          if (parsed.usage) {
            usage = extractUsage(parsed.usage)
          }
        } catch (err) {
          // Swallow parse errors for malformed chunks; the stream may contain
          // provider-specific lines we don't care about.
          if ((err as Error).message?.startsWith("stream error")) throw err
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {})
  }

  return { content, usage }
}
