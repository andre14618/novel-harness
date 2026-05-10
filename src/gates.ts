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
import { logExhaustionFired, logExhaustionResolved } from "./db/chapter-exhaustions"

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
  /**
   * - `plan-check-exhausted`: chapter-plan-checker / continuity / functional / validation blocker remained after retries.
   * - `reviser-rejected`: chapter-plan-reviser produced an outline rejected by post-revision sanity checks.
   * - `integrity-exhausted` (L64): chapter prose failed `detectProseIntegrityIssues` on the final attempt; mirrors the operator-visible dispatch shape so the operator can edit the outline, override, or abort instead of the chapter silently pausing.
   */
  kind: "plan-check-exhausted" | "reviser-rejected" | "integrity-exhausted"
  novelId: string
  chapter: number
  /** Outer drafting attempt that fired this gate. Used for telemetry; payload
   *  is constructed in drafting.ts which has the attempts counter in scope. */
  attempt: number
  outline: ChapterOutline
  prose: string
  unresolvedDeviations: Array<{
    description: string
    beat_index: number | null
    beatId?: string
    metadata?: Record<string, unknown>
  }>
  reviserHistory?: {
    attemptedScenes: SceneBeat[]
    rejectionReason: string
  }
}

export interface PlanAssistAllowedEntityPatch {
  beatIndex: number
  entities: string[]
}

/**
 * Discriminated decision shape. `edit-plan` carries a replacement outline
 * (validated server-side). `override` skips plan-check for remaining
 * attempts of this chapter — step 3 will persist this durably.
 * `allow-entities` appends reviewed walk-on/lore terms to the affected
 * scenes' `allowedNewEntities` lists and restarts the attempt. `abort`
 * stops the chapter and propagates the bail out to the run.
 */
export type PlanAssistDecision =
  | { action: "edit-plan"; outline: ChapterOutline; exhaustionId?: number | null }
  | { action: "override"; exhaustionId?: number | null }
  | { action: "allow-entities"; patches: PlanAssistAllowedEntityPatch[]; exhaustionId?: number | null }
  | { action: "abort"; exhaustionId?: number | null }

interface PendingPlanAssistGate {
  novelId: string
  chapter: number
  payload: PlanAssistGatePayload
  resolve: (decision: PlanAssistDecision) => void
  createdAt: number
  exhaustionId: Promise<number>
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
export async function requestPlanAssist(
  payload: PlanAssistGatePayload,
  mode: GateResolverMode,
): Promise<PlanAssistDecision> {
  // Telemetry row fires for every gate open — including auto mode, where
  // the row persists as "pending" (no decision) because the run bails
  // synchronously via PipelineBailError.
  //
  // Auto mode: AWAIT the insert before throwing. The run is about to
  // bail and the orchestrator's catch handler logs lastRunError from
  // the thrown error, but without the row landing first there's no
  // durable record of WHY the run bailed. The ~1 DB round-trip on the
  // auto-mode bail path is acceptable cost for this observability.
  //
  // Web/CLI mode: fire-and-forget is fine — the gate waits for a user
  // decision which takes orders of magnitude longer than the insert.
  const fireP = logExhaustionFired({
    novelId: payload.novelId,
    chapter: payload.chapter,
    attempt: payload.attempt,
    kind: payload.kind,
    resolverMode: mode,
    unresolvedDeviations: payload.unresolvedDeviations,
    reviserHistory: payload.reviserHistory ?? null,
  }).catch(err => {
    console.warn(`[gates] logExhaustionFired failed: ${err instanceof Error ? err.message : err}`)
    return 0
  })

  // Emit the gate-opened events in ALL modes (including auto) so that
  // pipeline observers and test runners waiting for gate:plan-assist are
  // notified before the auto-mode throw. Previously these were inside the
  // Promise constructor which was never reached in auto mode, causing
  // auto-mode waiters to hang indefinitely.
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

  if (mode === "auto") {
    await fireP
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
      exhaustionId: fireP,
    }
    pendingPlanAssistGates.set(key, gate)
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

  // Telemetry — persist the decision on the matching row before unblocking
  // drafting, so downstream lineage can cite the chapter_exhaustions row.
  ;(async () => {
    let exhaustionId = await gate.exhaustionId.catch(() => 0)
    try {
      const resolvedId = await logExhaustionResolved({
        novelId,
        chapter,
        decision: decision.action,
        decisionDetails: decision.action === "edit-plan"
          ? decision.outline
          : decision.action === "allow-entities"
            ? { patches: decision.patches }
            : null,
      })
      if (typeof resolvedId === "number" && resolvedId > 0) exhaustionId = resolvedId
    } catch (err) {
      console.warn(`[gates] logExhaustionResolved failed: ${err instanceof Error ? err.message : err}`)
    }
    gate.resolve(withExhaustionId(decision, exhaustionId))
  })().catch((err) => {
    console.warn(`[gates] resolvePlanAssist failed after gate resolution: ${err instanceof Error ? err.message : err}`)
    gate.resolve(decision)
  })

  return true
}

function withExhaustionId(decision: PlanAssistDecision, exhaustionId: number): PlanAssistDecision {
  if (exhaustionId <= 0) return decision
  return { ...decision, exhaustionId } as PlanAssistDecision
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

/**
 * In normal pipeline flow the two gate types are mutually exclusive —
 * plan-assist fires on drafting exhaustion (pipeline blocked awaiting
 * structural input), approval fires at end-of-chapter after a successful
 * draft. If both are ever open simultaneously (defensive coding: shouldn't
 * happen), plan-assist wins because it blocks forward progress, while
 * approval is a routine checkpoint that can be resolved second. This order
 * also avoids silently masking an exhaustion gate behind an approval gate
 * for list/state endpoints.
 */
export function getPendingGate(novelId: string): CurrentGate | null {
  const planAssist = getPendingPlanAssist(novelId)
  if (planAssist) {
    return { kind: "plan-assist", chapter: planAssist.chapter, payload: planAssist.payload }
  }
  const approval = getPending(novelId)
  if (approval) {
    return {
      kind: "approval",
      gateId: approval.gateId,
      title: approval.title,
      content: approval.content,
    }
  }
  return null
}
