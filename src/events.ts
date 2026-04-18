/**
 * SSE event bus for real-time novel pipeline updates.
 *
 * Maps novelId → connected SSE clients. The orchestrator server
 * uses subscribeSSE() to create SSE streams; pipeline code uses emit()
 * to push progress/gate events to connected browsers.
 */

export type NovelEventType =
  | "phase:changed"
  | "gate:waiting"
  | "gate:resolved"
  | "progress"
  | "error"
  | "done"
  | "connected"
  | "tonal-start"
  | "tonal-progress"
  | "tonal-chapter-start"
  | "tonal-chapter-done"
  | "tonal-done"
  | "tonal-error"

export interface NovelEvent {
  type: NovelEventType
  data: Record<string, unknown>
  timestamp?: string
}

type SSEController = ReadableStreamDefaultController<Uint8Array>

const clients = new Map<string, Set<SSEController>>()
const encoder = new TextEncoder()

function sendSSE(controller: SSEController, data: Record<string, unknown>): boolean {
  try {
    const msg = encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
    controller.enqueue(msg)
    return true
  } catch {
    return false
  }
}

export function subscribeSSE(novelId: string): ReadableStream<Uint8Array> {
  let myController: SSEController

  return new ReadableStream<Uint8Array>({
    start(controller) {
      myController = controller
      if (!clients.has(novelId)) clients.set(novelId, new Set())
      clients.get(novelId)!.add(controller)

      // Send initial connection event with timestamp
      sendSSE(controller, {
        type: "connected",
        data: { novelId },
        timestamp: new Date().toISOString(),
      })

      // Send keepalive every 30s to prevent connection timeout
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"))
        } catch {
          clearInterval(keepalive)
        }
      }, 30000)
    },
    cancel() {
      clients.get(novelId)?.delete(myController)
      if (clients.get(novelId)?.size === 0) clients.delete(novelId)
    },
  })
}

export function emit(novelId: string, event: NovelEvent): void {
  const set = clients.get(novelId)
  if (!set || set.size === 0) return

  const payload = { ...event, timestamp: event.timestamp ?? new Date().toISOString() }

  for (const controller of set) {
    if (!sendSSE(controller, payload)) {
      set.delete(controller)
    }
  }
}

export function hasClients(novelId: string): boolean {
  const set = clients.get(novelId)
  return !!set && set.size > 0
}

export function clientCount(novelId: string): number {
  return clients.get(novelId)?.size ?? 0
}
