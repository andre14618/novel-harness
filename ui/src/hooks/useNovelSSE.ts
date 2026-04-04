import { useEffect, useRef, useState, useCallback } from "react"
import type { SSEEvent } from "../api"

export function useNovelSSE(novelId: string | null) {
  const [events, setEvents] = useState<SSEEvent[]>([])
  const [connected, setConnected] = useState(false)
  const [lastEvent, setLastEvent] = useState<SSEEvent | null>(null)
  const sourceRef = useRef<EventSource | null>(null)

  const connect = useCallback(() => {
    if (!novelId) return

    const key = new URLSearchParams(window.location.search).get("key") ?? ""
    const url = `/api/novel/${novelId}/events?key=${encodeURIComponent(key)}`
    const source = new EventSource(url)
    sourceRef.current = source

    source.onopen = () => setConnected(true)

    source.onmessage = (e) => {
      try {
        const event: SSEEvent = JSON.parse(e.data)
        setLastEvent(event)
        setEvents(prev => [...prev.slice(-99), event])
      } catch {}
    }

    source.onerror = () => {
      setConnected(false)
      source.close()
      // Reconnect after 3s
      setTimeout(connect, 3000)
    }
  }, [novelId])

  useEffect(() => {
    connect()
    return () => {
      sourceRef.current?.close()
      sourceRef.current = null
    }
  }, [connect])

  const clearEvents = useCallback(() => setEvents([]), [])

  return { events, connected, lastEvent, clearEvents }
}
