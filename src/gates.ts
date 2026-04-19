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
import { trace } from "./trace"
import type { ChapterOutline } from "./types"
import type { SceneBeat } from "./schemas/shared"

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

// ── Plan-assist gate (exhaustion handler — design memo step 2) ────────

/**
 * Payload surfaced when the drafting pipeline exhausts automated repair.
 * `kind` discriminates the cause; `reviserHistory` is only present when a
 * reviser ran and was rejected by post-revision sanity checks.
 */
export interface PlanAssistGatePayload {
  kind: "plan-check-exhausted" | "reviser-rejected"
  novelId: string
  chapter: number
  outline: ChapterOutline
  prose: string
  unresolvedDeviations: Array<{ description: string; beat_index: number | null }>
  reviserHistory?: {
    attemptedScenes: SceneBeat[]
    rejectionReason: string
  }
}

/**
 * Discriminated decision shape. `edit-plan` carries a replacement outline
 * (validated server-side). `override` skips plan-check for remaining
 * attempts of this chapter — step 3 will persist this durably. `abort`
 * stops the chapter and propagates the bail out to the run.
 */
export type PlanAssistDecision =
  | { action: "edit-plan"; outline: ChapterOutline }
  | { action: "override" }
  | { action: "abort" }

interface PendingPlanAssistGate {
  novelId: string
  chapter: number
  payload: PlanAssistGatePayload
  resolve: (decision: PlanAssistDecision) => void
  createdAt: number
}

const pendingPlanAssistGates = new Map<string, PendingPlanAssistGate>()

function planAssistKey(novelId: string, chapter: number): string {
  return `${novelId}::ch${chapter}`
}

/**
 * Error raised when the drafting pipeline halts at a plan-assist gate in
 * auto mode. Auto-mode runs cannot invent an operator decision — halting
 * loudly is preferred over silent exhaustion-masking. The orchestrator
 * catch handler captures this structurally in `lastRunErrors`.
 */
export class PipelineBailError extends Error {
  constructor(
    public readonly kind: PlanAssistGatePayload["kind"],
    public readonly novelId: string,
    public readonly chapter: number,
    public readonly payload: PlanAssistGatePayload,
  ) {
    super(`Pipeline bailed at plan-assist gate (chapter ${chapter}, kind ${kind})`)
    this.name = "PipelineBailError"
  }
}

/**
 * Request a plan-assist decision at a drafting-exhaustion point.
 *
 * Auto mode: throws `PipelineBailError` synchronously. The run halts loudly.
 * Web/CLI mode: registers a pending gate and emits `gate:plan-assist` SSE
 * event with the full payload. Returns a promise that resolves when the
 * gate is resolved via `resolvePlanAssist`.
 */
export function requestPlanAssist(
  payload: PlanAssistGatePayload,
  mode: GateResolverMode,
): Promise<PlanAssistDecision> {
  if (mode === "auto") {
    throw new PipelineBailError(payload.kind, payload.novelId, payload.chapter, payload)
  }

  return new Promise<PlanAssistDecision>((resolve) => {
    const key = planAssistKey(payload.novelId, payload.chapter)
    const gate: PendingPlanAssistGate = {
      novelId: payload.novelId,
      chapter: payload.chapter,
      payload,
      resolve,
      createdAt: Date.now(),
    }
    pendingPlanAssistGates.set(key, gate)

    emit(payload.novelId, {
      type: "gate:plan-assist",
      data: {
        kind: payload.kind,
        chapter: payload.chapter,
        outline: payload.outline,
        prose: payload.prose,
        unresolvedDeviations: payload.unresolvedDeviations,
        reviserHistory: payload.reviserHistory ?? null,
      },
    })
    trace(payload.novelId, {
      eventType: "plan-assist-wait",
      chapter: payload.chapter,
      payload: { kind: payload.kind },
    }).catch(() => {})
  })
}

/**
 * Resolve a pending plan-assist gate. Returns false when no gate is
 * waiting for the given (novelId, chapter).
 */
export function resolvePlanAssist(
  novelId: string,
  chapter: number,
  decision: PlanAssistDecision,
): boolean {
  const key = planAssistKey(novelId, chapter)
  const gate = pendingPlanAssistGates.get(key)
  if (!gate) return false

  pendingPlanAssistGates.delete(key)
  gate.resolve(decision)

  emit(novelId, {
    type: "gate:plan-assist-resolved",
    data: { chapter, action: decision.action },
  })
  const waitMs = Date.now() - gate.createdAt
  trace(novelId, {
    eventType: "plan-assist-resolve",
    chapter,
    durationMs: waitMs,
    payload: { action: decision.action },
  }).catch(() => {})

  return true
}

/**
 * First pending plan-assist gate for a novel (at most one per chapter;
 * typically at most one per novel at a time). Separate from
 * `getPending()` which only covers approval gates.
 */
export function getPendingPlanAssist(
  novelId: string,
): Omit<PendingPlanAssistGate, "resolve"> | null {
  for (const gate of pendingPlanAssistGates.values()) {
    if (gate.novelId === novelId) {
      const { resolve: _, ...rest } = gate
      return rest
    }
  }
  return null
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
    // Persist gate-wait to trace timeline (fire-and-forget)
    trace(novelId, { eventType: "gate-wait", payload: { gateId, title } }).catch(() => {})
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
  // Persist gate resolution to trace timeline
  const waitMs = Date.now() - gate.createdAt
  trace(novelId, { eventType: "gate-resolve", durationMs: waitMs, payload: { gateId, action: decision.action } }).catch(() => {})

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

/**
 * Unified "what gate is open on this novel" view across both gate types.
 * Prefer this over `getPending()` for any surface that should render
 * either an approval gate or a plan-assist gate (e.g. the state endpoint,
 * the novel list). Returns null when no gate is open.
 */
export type CurrentGate =
  | { kind: "approval"; gateId: string; title: string; content: string }
  | { kind: "plan-assist"; chapter: number; payload: PlanAssistGatePayload }

export function getPendingGate(novelId: string): CurrentGate | null {
  const approval = getPending(novelId)
  if (approval) {
    return {
      kind: "approval",
      gateId: approval.gateId,
      title: approval.title,
      content: approval.content,
    }
  }
  const planAssist = getPendingPlanAssist(novelId)
  if (planAssist) {
    return { kind: "plan-assist", chapter: planAssist.chapter, payload: planAssist.payload }
  }
  return null
}
