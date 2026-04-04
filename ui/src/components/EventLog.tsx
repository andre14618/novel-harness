import type { SSEEvent } from "../api"

interface Props {
  events: SSEEvent[]
  connected: boolean
}

export function EventLog({ events, connected }: Props) {
  return (
    <div>
      <h3>
        <span className={`connected-dot ${connected ? "on" : "off"}`} />
        Event Log
      </h3>
      <div className="event-log">
        {events.length === 0 ? (
          <div className="event" style={{ color: "#555" }}>Waiting for events...</div>
        ) : (
          events.map((e, i) => (
            <div key={i} className="event">
              <span className="time">
                {new Date(e.timestamp).toLocaleTimeString()}
              </span>
              <span className="type">{e.type}</span>
              {formatEventData(e)}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function formatEventData(e: SSEEvent): string {
  const d = e.data
  switch (e.type) {
    case "phase:changed": return `→ ${d.phase}`
    case "gate:waiting": return `${d.title}`
    case "gate:resolved": return `${d.gateId}: ${d.action}`
    case "progress":
      const parts = [d.step as string]
      if (d.chapter) parts.push(`ch${d.chapter}`)
      if (d.status) parts.push(d.status as string)
      if (d.wordCount) parts.push(`${d.wordCount}w`)
      if (d.issueCount !== undefined) parts.push(`${d.issueCount} issues`)
      return parts.join(" · ")
    case "error": return `${d.step}: ${d.error}`
    case "done": return "Novel complete"
    default: return JSON.stringify(d)
  }
}
