import { useEffect, useRef } from "react"
import type { SSEEvent } from "../api"

interface Props {
  events: SSEEvent[]
  connected: boolean
}

export function EventLog({ events, connected }: Props) {
  const logRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new events
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [events.length])

  return (
    <div>
      <h3>
        <span className={`connected-dot ${connected ? "on" : "off"}`} />
        Event Log
      </h3>
      <div className="event-log" ref={logRef}>
        {events.length === 0 ? (
          <div className="event" style={{ color: "#555" }}>Waiting for events...</div>
        ) : (
          events.map((e, i) => (
            <div key={i} className="event">
              <span className="time">{formatTime(e.timestamp)}</span>
              <span className="type">{e.type}</span>
              {formatEventData(e)}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function formatTime(ts: string): string {
  if (!ts) return ""
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ""
  return d.toLocaleTimeString()
}

function formatEventData(e: SSEEvent): string {
  const d = e.data
  switch (e.type) {
    case "phase:changed": return `\u2192 ${d.phase}`
    case "gate:waiting": return `${d.title}`
    case "gate:resolved": return `${d.gateId}: ${d.action}`
    case "progress": {
      const parts = [d.step as string]
      if (d.chapter) parts.push(`ch${d.chapter}`)
      if (d.status) parts.push(d.status as string)
      if (d.wordCount) parts.push(`${d.wordCount}w`)
      if (d.issueCount !== undefined) parts.push(`${d.issueCount} issues`)
      if (d.notes) parts.push(`${d.notes} notes`)
      return parts.join(" \u00b7 ")
    }
    case "error": return `${d.step}: ${d.error}`
    case "done": return "Novel complete"
    default: return JSON.stringify(d)
  }
}
