/**
 * SSE client + expectation-matcher for the exhaustion-handler test campaign.
 *
 * Connects to /api/novel/:id/events and resolves when all expected matchers
 * fire in order, or rejects on timeout / pipeline error event.
 *
 * Wire format (from src/events.ts sendSSE):
 *   data: {"type":"trace","data":{...},"timestamp":"..."}\n\n
 *   data: {"type":"gate:plan-assist","data":{...},"timestamp":"..."}\n\n
 *   : keepalive\n\n
 *
 * Trace events:
 *   type === "trace", data.eventType === "debug-inject" | "plan-check-outcome" | ...
 *   Payload fields are spread directly into data (see src/trace.ts line 88-96).
 *
 * Native events:
 *   type === "gate:plan-assist"        → data has { kind, chapter, outline, prose }
 *   type === "gate:plan-assist-resolved" → data has { chapter, action }
 *   type === "error"                   → data has { error }
 *   type === "done"                    → data has {}
 */

export type SSEEventMatcher = {
  /** Human-readable label for log output. */
  name: string
  /** Returns true when this event satisfies the expectation. */
  match: (event: { type: string; data: Record<string, any> }) => boolean
  /** Per-matcher timeout in ms. Defaults to 300_000 (5 min). */
  timeoutMs?: number
}

export type SSEWatchResult = {
  name: string
  matched: boolean
  event?: { type: string; data: Record<string, any> }
  elapsedMs: number
  error?: string
}

/**
 * Subscribes to /api/novel/:id/events and resolves when ALL expected matchers
 * fire (in order). Rejects if any matcher times out or an `error` event arrives
 * on the stream.
 */
export async function watchForExpectations(params: {
  novelId: string
  apiBase: string
  apiKey: string
  expectations: SSEEventMatcher[]
  overallTimeoutMs?: number
  onEvent?: (event: { type: string; data: Record<string, any> }) => void
}): Promise<SSEWatchResult[]> {
  const {
    novelId,
    apiBase,
    apiKey,
    expectations,
    overallTimeoutMs = 25 * 60_000,
    onEvent,
  } = params

  const results: SSEWatchResult[] = []
  const abort = new AbortController()

  // Fire overall timeout
  const overallTimer = setTimeout(() => {
    abort.abort(new Error(`SSE overall timeout after ${overallTimeoutMs}ms`))
  }, overallTimeoutMs)

  try {
    const url = `${apiBase}/api/novel/${novelId}/events`
    const resp = await fetch(url, {
      headers: {
        "Accept": "text/event-stream",
        ...(apiKey ? { "x-api-key": apiKey } : {}),
      },
      signal: abort.signal,
    })

    if (!resp.ok || !resp.body) {
      throw new Error(`SSE connect failed: ${resp.status} ${resp.statusText}`)
    }

    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buf = ""

    let pendingIdx = 0
    let matcherStart = Date.now()
    let matcherTimer: ReturnType<typeof setTimeout> | null = null

    function armMatcherTimer() {
      if (matcherTimer) clearTimeout(matcherTimer)
      const timeoutMs = expectations[pendingIdx]?.timeoutMs ?? 300_000
      matcherTimer = setTimeout(() => {
        abort.abort(
          new Error(
            `SSE matcher "${expectations[pendingIdx]?.name}" timed out after ${timeoutMs}ms`,
          ),
        )
      }, timeoutMs)
    }

    if (expectations.length > 0) {
      matcherStart = Date.now()
      armMatcherTimer()
    }

    // Parse the stream until all matchers fire or we exhaust
    outer: while (pendingIdx < expectations.length) {
      let chunk: ReadableStreamReadResult<Uint8Array>
      try {
        chunk = await reader.read()
      } catch (err: any) {
        // AbortController fired
        if (abort.signal.aborted) {
          break outer
        }
        throw err
      }
      if (chunk.done) break

      buf += decoder.decode(chunk.value, { stream: true })

      // Split on the SSE delimiter \n\n
      const messages = buf.split("\n\n")
      // Last element may be a partial message — keep it in buf
      buf = messages.pop() ?? ""

      for (const raw of messages) {
        const trimmed = raw.trim()
        // Skip keepalive lines and empty frames
        if (!trimmed || trimmed.startsWith(":")) continue

        // Extract data: line (may be multi-line in theory, but our server uses one)
        const dataLine = trimmed
          .split("\n")
          .find(l => l.startsWith("data:"))
        if (!dataLine) continue

        const jsonStr = dataLine.slice("data:".length).trim()
        if (!jsonStr) continue

        let parsed: { type: string; data: Record<string, any>; timestamp?: string }
        try {
          parsed = JSON.parse(jsonStr)
        } catch {
          // Malformed — skip silently
          continue
        }

        const event = { type: parsed.type ?? "", data: parsed.data ?? {} }

        onEvent?.(event)

        // Pipeline error — fail fast
        if (event.type === "error") {
          if (matcherTimer) clearTimeout(matcherTimer)
          throw new Error(
            `SSE stream reported pipeline error: ${JSON.stringify(event.data)}`,
          )
        }

        // Try matching against current expectation
        if (pendingIdx < expectations.length) {
          const matcher = expectations[pendingIdx]
          if (matcher.match(event)) {
            const elapsed = Date.now() - matcherStart
            results.push({ name: matcher.name, matched: true, event, elapsedMs: elapsed })
            pendingIdx++
            if (pendingIdx < expectations.length) {
              matcherStart = Date.now()
              armMatcherTimer()
            } else {
              if (matcherTimer) clearTimeout(matcherTimer)
            }
          }
        }
      }
    }

    // If aborted mid-stream, surface the abort reason
    if (abort.signal.aborted && pendingIdx < expectations.length) {
      if (matcherTimer) clearTimeout(matcherTimer)
      const reason = abort.signal.reason
      const missing = expectations[pendingIdx]
      results.push({
        name: missing.name,
        matched: false,
        elapsedMs: Date.now() - matcherStart,
        error: reason?.message ?? String(reason),
      })
      reader.cancel().catch(() => {})
      throw new Error(
        reason?.message ?? `SSE watch aborted at expectation "${missing.name}"`,
      )
    }

    reader.cancel().catch(() => {})
    return results
  } finally {
    clearTimeout(overallTimer)
    if (!abort.signal.aborted) abort.abort()
  }
}

/**
 * Waits for ANY of a set of terminal events (done, error, phase:changed) and
 * returns the first one that fires. Returns null on timeout.
 */
export async function watchForTerminal(params: {
  novelId: string
  apiBase: string
  apiKey: string
  terminalTypes?: string[]
  timeoutMs?: number
  onEvent?: (event: { type: string; data: Record<string, any> }) => void
}): Promise<{ type: string; data: any } | null> {
  const {
    novelId,
    apiBase,
    apiKey,
    terminalTypes = ["done", "error", "phase:changed"],
    timeoutMs = 25 * 60_000,
    onEvent,
  } = params

  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), timeoutMs)

  try {
    const url = `${apiBase}/api/novel/${novelId}/events`
    const resp = await fetch(url, {
      headers: {
        "Accept": "text/event-stream",
        ...(apiKey ? { "x-api-key": apiKey } : {}),
      },
      signal: abort.signal,
    })

    if (!resp.ok || !resp.body) return null

    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buf = ""

    try {
      while (true) {
        let chunk: ReadableStreamReadResult<Uint8Array>
        try {
          chunk = await reader.read()
        } catch {
          return null
        }
        if (chunk.done) return null

        buf += decoder.decode(chunk.value, { stream: true })
        const messages = buf.split("\n\n")
        buf = messages.pop() ?? ""

        for (const raw of messages) {
          const trimmed = raw.trim()
          if (!trimmed || trimmed.startsWith(":")) continue

          const dataLine = trimmed.split("\n").find(l => l.startsWith("data:"))
          if (!dataLine) continue

          const jsonStr = dataLine.slice("data:".length).trim()
          if (!jsonStr) continue

          let parsed: any
          try { parsed = JSON.parse(jsonStr) } catch { continue }

          const event = { type: parsed.type ?? "", data: parsed.data ?? {} }
          onEvent?.(event)

          if (terminalTypes.includes(event.type)) {
            reader.cancel().catch(() => {})
            return event
          }
        }
      }
    } finally {
      reader.cancel().catch(() => {})
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
    if (!abort.signal.aborted) abort.abort()
  }
}
