/**
 * SSE event bus for real-time novel pipeline updates.
 *
 * Maps novelId → connected SSE clients. The orchestrator server
 * uses subscribe() to create SSE streams; pipeline code uses emit()
 * to push progress/gate events to connected browsers.
 */

export interface NovelEvent {
  type: "phase:changed" | "gate:waiting" | "gate:resolved" | "progress" | "error" | "done"
  data: Record<string, unknown>
  timestamp?: string
}

type SSEController = ReadableStreamDefaultController<Uint8Array>

const clients = new Map<string, Set<SSEController>>()
const encoder = new TextEncoder()

export function subscribe(novelId: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (!clients.has(novelId)) clients.set(novelId, new Set())
      clients.get(novelId)!.add(controller)

      // Send initial connection event
      const msg = `data: ${JSON.stringify({ type: "connected", data: { novelId } })}\n\n`
      controller.enqueue(encoder.encode(msg))
    },
    cancel(controller) {
      const set = clients.get(novelId)
      // ReadableStream cancel passes the reason, not the controller.
      // We need to clean up differently — use a ref.
    },
  })
}

// Overwrite subscribe with a version that properly tracks cleanup
const controllerRefs = new Map<string, Map<SSEController, () => void>>()

export function subscribeSSE(novelId: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (!clients.has(novelId)) clients.set(novelId, new Set())
      clients.get(novelId)!.add(controller)
      if (!controllerRefs.has(novelId)) controllerRefs.set(novelId, new Map())
      controllerRefs.get(novelId)!.set(controller, () => {
        clients.get(novelId)?.delete(controller)
        if (clients.get(novelId)?.size === 0) clients.delete(novelId)
        controllerRefs.get(novelId)?.delete(controller)
      })

      const msg = `data: ${JSON.stringify({ type: "connected", data: { novelId } })}\n\n`
      controller.enqueue(encoder.encode(msg))
    },
    cancel() {
      // Find and remove this controller
      const refs = controllerRefs.get(novelId)
      if (refs) {
        for (const [ctrl, cleanup] of refs) {
          try { ctrl.close() } catch {}
          cleanup()
          break // cancel is called once per stream
        }
      }
    },
  })
}

export function emit(novelId: string, event: NovelEvent): void {
  const set = clients.get(novelId)
  if (!set || set.size === 0) return

  const payload = { ...event, timestamp: event.timestamp ?? new Date().toISOString() }
  const msg = encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)

  for (const controller of set) {
    try {
      controller.enqueue(msg)
    } catch {
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
