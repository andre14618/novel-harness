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
 * fire (in order). Rejects if any matcher times out or an unexpected `error`
 * event arrives on the stream.
 *
 * Race-safety: before opening the SSE stream, this function seeds the matcher
 * chain from GET /api/novel/:id/trace so that events which fired between
 * startNovel() and the SSE connect are not missed. If all expectations match
 * from the trace seed alone, the SSE stream is never opened.
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

  // Diagnostic timers — declared here so the outer finally can clear them
  // even if the try block throws before they're armed.
  let stallLogInterval: ReturnType<typeof setInterval> | null = null
  let hardStallTimer: ReturnType<typeof setTimeout> | null = null

  // ── Fix Q10b: Seed matcher state from /trace before opening SSE ─────────
  // Track event IDs we've already processed from the trace seed so the live
  // SSE stream can skip duplicates.
  const seenEventIds = new Set<number>()

  let pendingIdx = 0
  let matcherStart = Date.now()

  try {
    // Fetch historical trace rows and replay them through the matcher chain.
    // This closes the race between POST /start (fire-and-forget) and SSE connect.
    try {
      const traceUrl = `${apiBase}/api/novel/${novelId}/trace?limit=500`
      const traceResp = await fetch(traceUrl, {
        headers: apiKey ? { "x-api-key": apiKey } : {},
      })
      if (traceResp.ok) {
        const traceRows: any[] = await traceResp.json()
        for (const row of traceRows) {
          // Mark this DB row as seen so the live SSE stream skips it
          if (row.id != null) seenEventIds.add(row.id)

          // Reconstruct the SSE event shape that trace() broadcasts:
          //   { type: "trace", data: { id, eventType, chapter, beatIndex, agent, ...payload } }
          const event = {
            type: "trace" as string,
            data: {
              id: row.id,
              eventType: row.event_type,
              chapter: row.chapter,
              beatIndex: row.beat_index,
              agent: row.agent,
              llmCallId: row.llm_call_id,
              durationMs: row.duration_ms,
              ...(row.payload ?? {}),
            } as Record<string, any>,
          }

          onEvent?.(event)

          if (pendingIdx < expectations.length) {
            const matcher = expectations[pendingIdx]
            if (matcher.match(event)) {
              const elapsed = Date.now() - matcherStart
              results.push({ name: matcher.name, matched: true, event, elapsedMs: elapsed })
              pendingIdx++
              matcherStart = Date.now()
            }
          }
        }
      }
    } catch {
      // Trace fetch failures are non-fatal — fall through to live SSE stream
    }

    // All expectations satisfied from trace seed — done without SSE connect
    if (pendingIdx >= expectations.length) {
      return results
    }

    // ── Open SSE stream for remaining expectations ──────────────────────
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

    let matcherTimer: ReturnType<typeof setTimeout> | null = null

    // ── Stall detector ──────────────────────────────────────────────────
    // Tracks every event's arrival time + subtype. Fires every 10s while
    // the matcher chain is stuck. Per Codex review ac6e95d3d010bac03:
    //   - 10s interval (was 30s) — 3x faster detection, still tidy
    //   - subtype-aware snapshot (trace:agent-complete agent=beat-writer,
    //     not collapsed to "trace") — most pipeline events ARE trace, so
    //     the bare type is information-free without the subtype
    let lastEventAt = Date.now()
    let lastEventLabel: string = "(none yet)"
    let eventsSinceHeartbeat = 0
    let unexpectedEventTypes: Record<string, number> = {}

    function labelForEvent(e: { type: string; data: Record<string, any> }): string {
      if (e.type === "trace") {
        const subtype = e.data?.eventType ?? "?"
        const agent = e.data?.agent
        return agent ? `trace:${subtype} agent=${agent}` : `trace:${subtype}`
      }
      return e.type
    }

    stallLogInterval = setInterval(() => {
      const pendingName = expectations[pendingIdx]?.name ?? "(none)"
      const ageSinceEvent = Math.round((Date.now() - lastEventAt) / 1000)
      const unexpectedSummary = Object.entries(unexpectedEventTypes)
        .map(([t, c]) => `${t}=${c}`)
        .join(", ") || "none"
      console.log(
        `  [STALL-CHECK] waiting="${pendingName}" | ` +
        `last-event=${lastEventLabel} (${ageSinceEvent}s ago) | ` +
        `events-in-window=${eventsSinceHeartbeat} | ` +
        `unexpected={${unexpectedSummary}}`,
      )
      eventsSinceHeartbeat = 0
      unexpectedEventTypes = {}
    }, 10_000)

    // Hard-stall abort: if no ANY event arrives for 5 min, fail fast.
    function armHardStallTimer() {
      if (hardStallTimer) clearTimeout(hardStallTimer)
      hardStallTimer = setTimeout(() => {
        const ageSec = Math.round((Date.now() - lastEventAt) / 1000)
        abort.abort(
          new Error(
            `SSE hard-stall: no events for ${ageSec}s while awaiting "${expectations[pendingIdx]?.name}". Last event type: ${lastEventType}. Unexpected types observed: ${JSON.stringify(unexpectedEventTypes)}`,
          ),
        )
      }, 300_000) // 5 min
    }
    armHardStallTimer()

    function armMatcherTimer() {
      if (matcherTimer) clearTimeout(matcherTimer)
      const timeoutMs = expectations[pendingIdx]?.timeoutMs ?? 300_000
      matcherTimer = setTimeout(() => {
        abort.abort(
          new Error(
            `SSE matcher "${expectations[pendingIdx]?.name}" timed out after ${timeoutMs}ms. Last event type: ${lastEventType}. Unexpected types observed: ${JSON.stringify(unexpectedEventTypes)}`,
          ),
        )
      }, timeoutMs)
    }

    if (pendingIdx < expectations.length) {
      armMatcherTimer()
    }

    // Helper: run the normal matcher chain against one event
    // Dedup-per-label UNEXPECTED log state (loud only on first 3 of each
    // label to avoid flooding when pipeline is emitting steady unexpected
    // activity).
    const unexpectedLogCounts: Record<string, number> = {}
    const UNEXPECTED_LOG_CAP_PER_LABEL = 3

    function processEvent(event: { type: string; data: Record<string, any> }): void {
      // Liveness tracking for the stall detector
      lastEventAt = Date.now()
      lastEventLabel = labelForEvent(event)
      eventsSinceHeartbeat++
      armHardStallTimer()  // reset the no-event watchdog on every event

      onEvent?.(event)

      // Fix Q5: only fast-fail on error events that no pending matcher accepts
      if (event.type === "error") {
        const accepted =
          pendingIdx < expectations.length && expectations[pendingIdx].match(event)
        if (!accepted) {
          if (matcherTimer) clearTimeout(matcherTimer)
          throw new Error(
            `Unexpected error event while awaiting "${expectations[pendingIdx]?.name}": ${JSON.stringify(event.data)}`,
          )
        }
        // Fall through — let the normal matcher handle it below
      }

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
        } else {
          // Unmatched event — track label for the stall-log summary AND
          // loud-log the first few occurrences of each distinct label.
          // Per Codex review ac6e95d3d010bac03: widened from 4-type
          // whitelist to ALL unmatched events (dedup prevents flood).
          const label = labelForEvent(event)

          // llm-in-flight is a pure liveness heartbeat (Codex review
          // a13ff46cc19e58d5a) — counts for lastEventAt liveness tracking
          // but is NOT a signal event. Skip the unexpected counter + loud
          // log so 5s heartbeats don't pollute the stall summary.
          if (event.type === "trace" && event.data?.eventType === "llm-in-flight") {
            // already counted in eventsSinceHeartbeat; nothing else to do
          } else {
            unexpectedEventTypes[label] = (unexpectedEventTypes[label] ?? 0) + 1
            const loudCount = (unexpectedLogCounts[label] ?? 0) + 1
            unexpectedLogCounts[label] = loudCount
            if (loudCount <= UNEXPECTED_LOG_CAP_PER_LABEL) {
              const dataSnippet = JSON.stringify(event.data).slice(0, 120)
              const more = loudCount === UNEXPECTED_LOG_CAP_PER_LABEL ? " (further occurrences suppressed)" : ""
              console.log(
                `  [UNEXPECTED] ${label} (data: ${dataSnippet}) ` +
                `while awaiting "${expectations[pendingIdx]?.name}"${more}`,
              )
            }
          }
        }
      }
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

        // Fix Q10b dedup: skip trace events we already processed from the seed
        if (event.type === "trace" && event.data.id != null && seenEventIds.has(event.data.id)) {
          continue
        }

        processEvent(event)
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
    if (stallLogInterval) clearInterval(stallLogInterval)
    if (hardStallTimer) clearTimeout(hardStallTimer)
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
