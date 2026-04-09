import { useEffect, useState, useRef, useCallback } from "react"
import { getTrace, getLLMCall } from "../api"
import type { TraceEvent, LLMCallDetail } from "../api"
import { useNovelSSE } from "../hooks/useNovelSSE"

const EVENT_TYPE_STYLES: Record<string, { color: string; dot: string; label: string }> = {
  "phase-change":             { color: "var(--accent)",         dot: "phase",  label: "Phase" },
  "agent-start":              { color: "var(--yellow)",         dot: "active", label: "Agent Start" },
  "agent-complete":           { color: "var(--accent)",         dot: "done",   label: "Agent" },
  "agent-fail":               { color: "var(--red)",            dot: "error",  label: "Agent Error" },
  "lint-detect":              { color: "var(--text-secondary)", dot: "info",   label: "Lint Detect" },
  "lint-fix-deterministic":   { color: "var(--text-secondary)", dot: "info",   label: "Lint Fix (det)" },
  "lint-fix-llm":             { color: "var(--blue)",           dot: "done",   label: "Lint Fix (LLM)" },
  "validation-check":         { color: "var(--text-secondary)", dot: "info",   label: "Validation" },
  "adherence-deterministic":  { color: "var(--text-secondary)", dot: "info",   label: "Adherence (det)" },
  "reference-resolution":     { color: "var(--text-secondary)", dot: "info",   label: "References" },
  "state-extraction":         { color: "var(--blue)",           dot: "done",   label: "State Extract" },
  "gate-wait":                { color: "var(--blue)",           dot: "gate",   label: "Gate Wait" },
  "gate-resolve":             { color: "var(--accent)",         dot: "done",   label: "Gate Resolve" },
  "error":                    { color: "var(--red)",            dot: "error",  label: "Error" },
}

function getStyle(eventType: string) {
  return EVENT_TYPE_STYLES[eventType] ?? { color: "var(--text-tertiary)", dot: "info", label: eventType }
}

function formatDuration(ms: number | null): string {
  if (ms == null) return ""
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ""
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 1 } as any)
}

function renderPayload(event: TraceEvent): React.ReactNode {
  const p = event.payload
  if (!p || Object.keys(p).length === 0) return null

  switch (event.event_type) {
    case "phase-change":
      return <span>{p.from} &rarr; {p.to}</span>

    case "agent-complete":
      return (
        <div className="tl-config">
          {p.promptTokens != null && <span className="config-tag">{p.promptTokens}+{p.completionTokens} tok</span>}
          {event.duration_ms != null && <span className="config-tag">{formatDuration(event.duration_ms)}</span>}
          {p.cost != null && p.cost > 0 && <span className="config-tag" style={{ color: "var(--accent)" }}>${Number(p.cost).toFixed(4)}</span>}
          {p.pass != null && <span className="config-tag" style={{ color: p.pass ? "var(--accent)" : "var(--red)" }}>{p.pass ? "pass" : "fail"}</span>}
        </div>
      )

    case "agent-fail":
      return <div className="tl-detail" style={{ color: "var(--red)" }}>{p.error}</div>

    case "lint-detect":
      return (
        <div className="tl-config">
          <span className="config-tag">{p.totalIssues} issues</span>
          {p.counts && Object.entries(p.counts as Record<string, number>).map(([cat, n]) => (
            <span key={cat} className="config-tag">{cat}: {n}</span>
          ))}
        </div>
      )

    case "lint-fix-deterministic":
      return <span className="config-tag">{p.fixed} fixed</span>

    case "lint-fix-llm":
      return (
        <div className="tl-config">
          <span className="config-tag">{p.fixed} fixed</span>
          <span className="config-tag">{p.unfixed} unfixed</span>
          <span className="config-tag">{p.llmCalls} calls</span>
          {p.cost != null && <span className="config-tag" style={{ color: "var(--accent)" }}>${Number(p.cost).toFixed(4)}</span>}
        </div>
      )

    case "validation-check":
      return (
        <div className="tl-config">
          <span className="config-tag" style={{ color: p.passed ? "var(--accent)" : "var(--red)" }}>
            {p.passed ? "passed" : `${(p.blockers as string[])?.length ?? 0} blockers`}
          </span>
          {(p.warnings as string[])?.length > 0 && <span className="config-tag">{(p.warnings as string[]).length} warnings</span>}
        </div>
      )

    case "adherence-deterministic":
      return (
        <div className="tl-config">
          <span className="config-tag" style={{ color: p.charPresence ? "var(--accent)" : "var(--red)" }}>chars {p.charPresence ? "ok" : "missing"}</span>
          <span className="config-tag" style={{ color: p.wordCountOk ? "var(--accent)" : "var(--red)" }}>wordcount {p.wordCountOk ? "ok" : "off"}</span>
          <span className="config-tag" style={{ color: p.dialogueOk ? "var(--accent)" : "var(--red)" }}>dialogue {p.dialogueOk ? "ok" : "missing"}</span>
        </div>
      )

    case "reference-resolution":
      return (
        <div className="tl-config">
          <span className="config-tag">{p.beats} beats</span>
          <span className="config-tag">{p.totalLookups} lookups</span>
          {p.llmUsedCount > 0 && <span className="config-tag">{p.llmUsedCount} LLM</span>}
        </div>
      )

    case "state-extraction":
      return <span className="config-tag">mode: {p.mode}</span>

    case "gate-wait":
      return <span>{p.title}</span>

    case "gate-resolve":
      return (
        <div className="tl-config">
          <span className="config-tag" style={{ color: p.action === "approve" ? "var(--accent)" : "var(--yellow)" }}>{p.action}</span>
          {event.duration_ms != null && <span className="config-tag">waited {formatDuration(event.duration_ms)}</span>}
        </div>
      )

    default:
      return <pre style={{ fontSize: "0.72rem", color: "var(--text-tertiary)" }}>{JSON.stringify(p, null, 2)}</pre>
  }
}

// ── Main component ──────────────────────────────────────────────────

interface Props {
  novelId: string
  /** When true, shows live SSE events as they arrive in addition to historical data */
  live?: boolean
}

export function TraceTimeline({ novelId, live = true }: Props) {
  const [events, setEvents] = useState<TraceEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [chapterFilter, setChapterFilter] = useState<number | null>(null)
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [callDetail, setCallDetail] = useState<LLMCallDetail | null>(null)
  const timelineEndRef = useRef<HTMLDivElement>(null)
  const { events: sseEvents } = useNovelSSE(live ? novelId : null)

  // Load historical events
  const loadEvents = useCallback(async () => {
    try {
      const filters: Record<string, any> = { limit: 1000 }
      if (chapterFilter != null) filters.chapter = chapterFilter
      if (typeFilter) filters.event_type = typeFilter
      const data = await getTrace(novelId, filters)
      setEvents(data)
    } catch {
      // silent — may not have events yet
    } finally {
      setLoading(false)
    }
  }, [novelId, chapterFilter, typeFilter])

  useEffect(() => { loadEvents() }, [loadEvents])

  // Merge live SSE trace events
  useEffect(() => {
    if (!live) return
    const newTraceEvents: TraceEvent[] = []
    for (const e of sseEvents) {
      if (e.type !== "trace") continue
      const d = e.data
      // Only append if not already in the list (by ID)
      if (d.id && !events.some(ev => ev.id === d.id)) {
        newTraceEvents.push({
          id: d.id as number,
          novel_id: novelId,
          run_id: null,
          chapter: (d.chapter as number) ?? null,
          beat_index: (d.beatIndex as number) ?? null,
          event_type: d.eventType as string,
          agent: (d.agent as string) ?? null,
          llm_call_id: (d.llmCallId as number) ?? null,
          duration_ms: (d.durationMs as number) ?? null,
          payload: d,
          timestamp: e.timestamp,
        })
      }
    }
    if (newTraceEvents.length > 0) {
      setEvents(prev => [...prev, ...newTraceEvents])
    }
  }, [sseEvents, live, novelId])

  // Auto-scroll on new events
  useEffect(() => {
    if (live) timelineEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [events.length, live])

  // Load LLM call detail on expand
  async function handleExpand(event: TraceEvent) {
    if (expandedId === event.id) {
      setExpandedId(null)
      setCallDetail(null)
      return
    }
    setExpandedId(event.id)
    setCallDetail(null)
    if (event.llm_call_id) {
      try {
        const detail = await getLLMCall(event.llm_call_id)
        setCallDetail(detail)
      } catch { /* silent */ }
    }
  }

  // Group events by chapter
  const chapters = new Set(events.filter(e => e.chapter != null).map(e => e.chapter!))
  const eventTypes = new Set(events.map(e => e.event_type))

  return (
    <div>
      {/* Filters */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        <select
          value={chapterFilter ?? ""}
          onChange={e => setChapterFilter(e.target.value ? parseInt(e.target.value) : null)}
          style={{ fontSize: "0.8rem" }}
        >
          <option value="">All chapters</option>
          {[...chapters].sort((a, b) => a - b).map(ch => (
            <option key={ch} value={ch}>Chapter {ch}</option>
          ))}
        </select>
        <select
          value={typeFilter ?? ""}
          onChange={e => setTypeFilter(e.target.value || null)}
          style={{ fontSize: "0.8rem" }}
        >
          <option value="">All events</option>
          {[...eventTypes].sort().map(t => (
            <option key={t} value={t}>{getStyle(t).label}</option>
          ))}
        </select>
        <button onClick={loadEvents} style={{ fontSize: "0.75rem", padding: "2px 8px" }}>Refresh</button>
        <span style={{ fontSize: "0.75rem", color: "var(--text-ghost)", alignSelf: "center" }}>
          {events.length} events
        </span>
      </div>

      {loading && <p style={{ color: "var(--text-ghost)" }}>Loading trace...</p>}

      {/* Timeline */}
      <div className="timeline">
        {events.map(event => {
          const style = getStyle(event.event_type)
          const isExpanded = expandedId === event.id
          const hasCallDetail = event.llm_call_id != null

          return (
            <div
              key={event.id}
              className={`tl-entry tl-${event.event_type === "agent-fail" || event.event_type === "error" ? "error" : event.event_type.startsWith("agent-") ? event.event_type : "info"}`}
              style={{ cursor: hasCallDetail ? "pointer" : undefined }}
              onClick={hasCallDetail ? () => handleExpand(event) : undefined}
            >
              <div className={`tl-dot ${style.dot}`} />
              <div className="tl-body">
                <div className="tl-time">
                  {formatTimestamp(event.timestamp)}
                  {event.chapter != null && <span style={{ marginLeft: "0.5rem" }}>Ch {event.chapter}</span>}
                  {event.beat_index != null && <span style={{ marginLeft: "0.3rem" }}>Beat {event.beat_index}</span>}
                  {event.duration_ms != null && <span style={{ marginLeft: "0.5rem", color: "var(--text-ghost)" }}>{formatDuration(event.duration_ms)}</span>}
                </div>
                <div className="tl-title" style={{ color: style.color }}>
                  {style.label}
                  {event.agent && <span style={{ fontWeight: "normal", color: "var(--text-secondary)", marginLeft: "0.4rem" }}>{event.agent}</span>}
                  {hasCallDetail && <span style={{ fontSize: "0.7rem", color: "var(--text-ghost)", marginLeft: "0.4rem" }}>{isExpanded ? "[-]" : "[+]"}</span>}
                </div>
                {renderPayload(event)}

                {/* Expanded LLM call detail */}
                {isExpanded && callDetail && (
                  <div style={{ marginTop: "0.5rem", padding: "0.5rem", background: "var(--bg-root)", borderRadius: "4px", fontSize: "0.78rem" }}>
                    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.4rem" }}>
                      <span className="config-tag">{callDetail.provider}</span>
                      <span className="config-tag">{callDetail.model}</span>
                      <span className="config-tag">{callDetail.prompt_tokens}+{callDetail.completion_tokens} tok</span>
                      <span className="config-tag">{callDetail.latency_ms}ms</span>
                      {Number(callDetail.cost) > 0 && <span className="config-tag" style={{ color: "var(--accent)" }}>${Number(callDetail.cost).toFixed(4)}</span>}
                      {callDetail.failed && <span className="config-tag" style={{ color: "var(--red)" }}>FAILED</span>}
                    </div>
                    {callDetail.system_prompt && (
                      <details style={{ marginBottom: "0.3rem" }}>
                        <summary style={{ color: "var(--text-ghost)", cursor: "pointer" }}>System prompt ({callDetail.system_prompt.length} chars)</summary>
                        <pre style={{ whiteSpace: "pre-wrap", fontSize: "0.72rem", color: "var(--text-secondary)", maxHeight: "200px", overflow: "auto" }}>{callDetail.system_prompt}</pre>
                      </details>
                    )}
                    {callDetail.user_prompt && (
                      <details style={{ marginBottom: "0.3rem" }}>
                        <summary style={{ color: "var(--text-ghost)", cursor: "pointer" }}>User prompt ({callDetail.user_prompt.length} chars)</summary>
                        <pre style={{ whiteSpace: "pre-wrap", fontSize: "0.72rem", color: "var(--text-secondary)", maxHeight: "200px", overflow: "auto" }}>{callDetail.user_prompt}</pre>
                      </details>
                    )}
                    {callDetail.response_content && (
                      <details>
                        <summary style={{ color: "var(--text-ghost)", cursor: "pointer" }}>Response ({callDetail.response_content.length} chars)</summary>
                        <pre style={{ whiteSpace: "pre-wrap", fontSize: "0.72rem", color: "var(--text-secondary)", maxHeight: "300px", overflow: "auto" }}>{callDetail.response_content}</pre>
                      </details>
                    )}
                    {callDetail.error_text && (
                      <pre style={{ whiteSpace: "pre-wrap", fontSize: "0.72rem", color: "var(--red)", marginTop: "0.3rem" }}>{callDetail.error_text}</pre>
                    )}
                  </div>
                )}
                {isExpanded && !callDetail && event.llm_call_id && (
                  <div style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "var(--text-ghost)" }}>Loading call detail...</div>
                )}
              </div>
            </div>
          )
        })}
        <div ref={timelineEndRef} />
      </div>

      {/* Summary stats */}
      {events.length > 0 && (() => {
        const agentEvents = events.filter(e => e.event_type === "agent-complete")
        const totalCost = agentEvents.reduce((s, e) => s + (Number(e.payload?.cost) || 0), 0)
        const totalDuration = events.reduce((s, e) => s + (e.duration_ms ?? 0), 0)
        const llmCount = agentEvents.length
        const detCount = events.filter(e => ["validation-check", "lint-detect", "lint-fix-deterministic", "adherence-deterministic", "reference-resolution"].includes(e.event_type)).length
        return (
          <div style={{ display: "flex", gap: "1rem", fontSize: "0.8rem", color: "var(--text-ghost)", marginTop: "0.5rem", padding: "0.5rem 0", borderTop: "1px solid var(--border)" }}>
            <span><strong style={{ color: "var(--accent)" }}>${totalCost.toFixed(4)}</strong> cost</span>
            <span>{llmCount} LLM calls</span>
            <span>{detCount} deterministic checks</span>
            <span>{formatDuration(totalDuration)} total</span>
          </div>
        )
      })()}
    </div>
  )
}
