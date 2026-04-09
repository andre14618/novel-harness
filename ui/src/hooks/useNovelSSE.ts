import { useEffect, useRef, useState, useCallback } from "react"
import type { SSEEvent } from "../api"

export function useNovelSSE(novelId: string | null) {
  const [events, setEvents] = useState<SSEEvent[]>([])
  const [connected, setConnected] = useState(false)
  const [lastEvent, setLastEvent] = useState<SSEEvent | null>(null)
  const sourceRef = useRef<EventSource | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    if (!novelId) return

    function connect() {
      // Clean up previous connection
      if (sourceRef.current) {
        sourceRef.current.close()
        sourceRef.current = null
      }
      clearTimeout(reconnectTimer.current)

      // Auth via cookie (nh_session) — EventSource sends cookies automatically.
      // Falls back to ?key= query param for backward compat.
      const key = new URLSearchParams(window.location.search).get("key") ?? ""
      const url = key
        ? `/api/novel/${novelId}/events?key=${encodeURIComponent(key)}`
        : `/api/novel/${novelId}/events`
      const source = new EventSource(url)
      sourceRef.current = source

      source.onopen = () => setConnected(true)

      source.onmessage = (e) => {
        try {
          const event: SSEEvent = JSON.parse(e.data)
          // Skip internal events (connected, keepalive)
          if (event.type === "connected") {
            setConnected(true)
            return
          }
          setLastEvent(event)
          setEvents(prev => [...prev.slice(-99), event])
        } catch {
          // ignore parse errors (keepalive comments etc)
        }
      }

      source.onerror = () => {
        setConnected(false)
        source.close()
        sourceRef.current = null
        // Reconnect after 3s
        reconnectTimer.current = setTimeout(connect, 3000)
      }
    }

    connect()

    return () => {
      clearTimeout(reconnectTimer.current)
      if (sourceRef.current) {
        sourceRef.current.close()
        sourceRef.current = null
      }
    }
  }, [novelId])

  const clearEvents = useCallback(() => setEvents([]), [])

  return { events, connected, lastEvent, clearEvents }
}
