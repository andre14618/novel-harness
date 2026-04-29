/**
 * Phase parity — replay transport.
 *
 * Two `LLMTransport` adapters that plug into `setTransport()` from
 * `src/transport.ts`:
 *
 *   - RecordTransport wraps DirectTransport, captures every (request,
 *     response) pair to an in-memory log that can be flushed to a JSON
 *     fixture file.
 *
 *   - ReplayTransport reads a JSON fixture and serves recorded responses
 *     by request hash. Throws on miss — the test is meant to fail loudly
 *     when the agent layer drifts.
 *
 * Request hashing is deterministic on the load-bearing fields:
 * (model, provider, temperature, system_prompt, user_prompt, max_tokens).
 * Streaming/onChunk callbacks and request-internal IDs are excluded —
 * they don't affect the response shape.
 */

import { createHash } from "node:crypto"
import { writeFileSync, readFileSync } from "node:fs"
import type { LLMTransport, LLMRequest, LLMResponse } from "../../src/transport"
import { DirectTransport } from "../../src/transport"

export interface RecordedCall {
  hash: string
  /** First-call wins for duplicates: a single (request) may be called many
   *  times if a downstream caller retries; we record the first response and
   *  reuse it. The seq counter is a debugging aid. */
  seq: number
  request: {
    model: string
    provider: string
    temperature: number
    maxTokens: number
    systemPrompt: string
    userPrompt: string
    callerId?: string
  }
  response: LLMResponse
}

export function hashRequest(req: LLMRequest): string {
  const canonical = JSON.stringify({
    m: req.model,
    p: req.provider,
    t: Math.round(req.temperature * 1e3) / 1e3,
    mt: req.maxTokens,
    s: req.systemPrompt,
    u: req.userPrompt,
  })
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32)
}

export class RecordTransport implements LLMTransport {
  readonly calls: RecordedCall[] = []
  private seen = new Map<string, RecordedCall>()
  private inner: LLMTransport
  private seq = 0

  constructor(inner: LLMTransport = new DirectTransport()) {
    this.inner = inner
  }

  async execute(request: LLMRequest): Promise<LLMResponse> {
    const hash = hashRequest(request)
    const existing = this.seen.get(hash)
    if (existing) return existing.response
    const response = await this.inner.execute(request)
    const call: RecordedCall = {
      hash,
      seq: this.seq++,
      request: {
        model: request.model,
        provider: request.provider,
        temperature: request.temperature,
        maxTokens: request.maxTokens,
        systemPrompt: request.systemPrompt,
        userPrompt: request.userPrompt,
        callerId: request.callerId,
      },
      response,
    }
    this.calls.push(call)
    this.seen.set(hash, call)
    return response
  }

  flushTo(path: string): void {
    writeFileSync(path, JSON.stringify({ calls: this.calls }, null, 2))
  }
}

export class ReplayTransport implements LLMTransport {
  private map = new Map<string, LLMResponse>()

  static fromFile(path: string): ReplayTransport {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { calls: RecordedCall[] }
    const t = new ReplayTransport()
    for (const c of raw.calls) t.map.set(c.hash, c.response)
    return t
  }

  async execute(request: LLMRequest): Promise<LLMResponse> {
    const hash = hashRequest(request)
    const hit = this.map.get(hash)
    if (!hit) {
      throw new Error(
        `[phase-parity] ReplayTransport miss: ${hash} ` +
        `(model=${request.model}, agent=${request.callerId ?? "?"}). ` +
        `The recorded fixture does not contain this request — the agent layer drifted.`,
      )
    }
    return hit
  }
}
