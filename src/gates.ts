/**
 * Gate abstraction — decouples human approval gates from stdin.
 *
 * Pipeline code calls `gateManager.request()` which returns a Promise.
 * That promise is resolved by one of:
 * 1. CLI readline (when running from terminal)
 * 2. Web API POST (when running from browser UI)
 * 3. Immediate approval (when in --auto mode)
 *
 * The gate manager also emits SSE events so connected browsers
 * see gate content and can respond.
 */

import { emit, hasClients } from "./events"

export interface GateDecision {
  action: "approve" | "revise" | "reject"
  notes?: string[]
}

export interface PendingGate {
  novelId: string
  gateId: string
  title: string
  content: string
  resolve: (decision: GateDecision) => void
  createdAt: number
}

export type GateResolverMode = "auto" | "cli" | "web"

const pendingGates = new Map<string, PendingGate>()

function gateKey(novelId: string, gateId: string): string {
  return `${novelId}::${gateId}`
}

/**
 * Request a human decision at a gate point in the pipeline.
 *
 * In auto mode, immediately returns "approve".
 * In web mode, emits an SSE event and waits for an API call.
 * In CLI mode, the caller (cli.ts) handles readline.
 *
 * Returns the mode so the caller knows whether to fall through to readline.
 */
export function request(
  novelId: string,
  gateId: string,
  title: string,
  content: string,
  mode: GateResolverMode,
): Promise<GateDecision> {
  // Auto mode — approve immediately
  if (mode === "auto") {
    return Promise.resolve({ action: "approve" })
  }

  return new Promise<GateDecision>((resolve) => {
    const key = gateKey(novelId, gateId)
    const gate: PendingGate = { novelId, gateId, title, content, resolve, createdAt: Date.now() }
    pendingGates.set(key, gate)

    // Emit SSE event for web clients
    emit(novelId, {
      type: "gate:waiting",
      data: { gateId, title, content },
    })
  })
}

/**
 * Resolve a pending gate (called from web API or CLI).
 */
export function resolve(novelId: string, gateId: string, decision: GateDecision): boolean {
  const key = gateKey(novelId, gateId)
  const gate = pendingGates.get(key)
  if (!gate) return false

  pendingGates.delete(key)
  gate.resolve(decision)

  emit(novelId, {
    type: "gate:resolved",
    data: { gateId, action: decision.action },
  })

  return true
}

/**
 * Get the currently pending gate for a novel (if any).
 */
export function getPending(novelId: string): Omit<PendingGate, "resolve"> | null {
  for (const gate of pendingGates.values()) {
    if (gate.novelId === novelId) {
      const { resolve: _, ...rest } = gate
      return rest
    }
  }
  return null
}

/**
 * List all pending gates.
 */
export function listPending(): Array<Omit<PendingGate, "resolve">> {
  return [...pendingGates.values()].map(({ resolve: _, ...rest }) => rest)
}

/**
 * Determine the resolver mode for a novel run.
 */
export function getMode(autoMode: boolean): GateResolverMode {
  if (autoMode) return "auto"
  // If we detect we're running inside the orchestrator (not a TTY), use web mode
  if (!process.stdin.isTTY) return "web"
  return "cli"
}
