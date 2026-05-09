/**
 * Unified pipeline trace — every event (LLM + deterministic) flows through here.
 *
 * Two things happen on each trace() call:
 *   1. Row inserted into pipeline_events (persistent, queryable)
 *   2. SSE broadcast via emit() (real-time UI updates)
 *
 * This replaces scattered emit() calls throughout the pipeline. The existing
 * emit() function in events.ts is kept for backward compat but trace() is
 * the primary API for all new instrumentation.
 */

import db from "./db/connection"
import { emit } from "./events"
import { getRunId } from "./logger"

// ── Event types ─────────────────────────────────────────────────────────

export type TraceEventType =
  | "phase-change"
  | "phase-complete"
  | "chapter-complete"
  | "agent-start"
  | "agent-complete"
  | "agent-fail"
  | "llm-call-start"
  | "lint-detect"
  | "lint-fix-deterministic"
  | "lint-fix-llm"
  | "lint-fix-rejected"
  | "lint-prose-edit-proposals"
  | "editorial-beat-coverage-proposals"
  | "continuity-editorial-flag-proposals"
  | "prose-integrity-repair"
  | "prose-integrity-check"
  | "validation-check"
  | "functional-check"
  | "adherence-deterministic"
  | "adherence-stage2-override"
  | "reference-resolution"
  | "writer-context"
  | "state-extraction"
  | "gate-wait"
  | "gate-resolve"
  | "plan-assist-wait"
  | "plan-assist-resolve"
  | "plan-check-outcome"
  | "plan-check-drift-witness"
  | "integrity-settle-recheck"
  | "integrity-settle-complete"
  | "debug-inject"
  | "llm-in-flight"
  // Collaborative proposal workflow (charter §1, design: collaborative-proposal-workflow.md)
  | "canon-proposal-create"
  | "canon-proposal-resolve"
  | "canon-proposal-generate-summary"
  | "proposal-outcome"
  | "error"

export interface TraceEvent {
  eventType: TraceEventType
  chapter?: number
  beatIndex?: number
  agent?: string
  llmCallId?: number | null
  durationMs?: number
  payload?: Record<string, unknown>
}

// ── Core emitter ────────────────────────────────────────────────────────

export async function trace(novelId: string, event: TraceEvent): Promise<number> {
  const runId = getRunId()
  const ts = new Date().toISOString()

  // 1. Persist to DB
  let eventId = 0
  try {
    const [row] = await db`
      INSERT INTO pipeline_events (novel_id, run_id, chapter, beat_index, event_type, agent, llm_call_id, duration_ms, payload, timestamp)
      VALUES (
        ${novelId},
        ${runId},
        ${event.chapter ?? null},
        ${event.beatIndex ?? null},
        ${event.eventType},
        ${event.agent ?? null},
        ${event.llmCallId ?? null},
        ${event.durationMs ?? null},
        ${event.payload ?? {}},
        ${ts}
      )
      RETURNING id
    `
    eventId = (row as any).id
  } catch (err) {
    // DB write failures must not block the pipeline. Log and continue.
    console.error(`[trace] failed to persist ${event.eventType}:`, err)
  }

  // 2. Broadcast via SSE for real-time UI
  emit(novelId, {
    type: "trace" as any,
    data: {
      id: eventId,
      eventType: event.eventType,
      chapter: event.chapter,
      beatIndex: event.beatIndex,
      agent: event.agent,
      llmCallId: event.llmCallId,
      durationMs: event.durationMs,
      ...event.payload,
    },
    timestamp: ts,
  })

  return eventId
}

// ── Convenience helpers ─────────────────────────────────────────────────

export function traceAgentStart(novelId: string, agent: string, opts?: { chapter?: number; beatIndex?: number; attempt?: number }) {
  return trace(novelId, {
    eventType: "agent-start",
    agent,
    chapter: opts?.chapter,
    beatIndex: opts?.beatIndex,
    payload: opts?.attempt != null ? { attempt: opts.attempt } : undefined,
  })
}

export function traceAgentComplete(
  novelId: string,
  agent: string,
  opts: {
    chapter?: number
    beatIndex?: number
    attempt?: number
    llmCallId?: number | null
    durationMs?: number
    tokens?: { prompt: number; completion: number }
    cost?: number
    pass?: boolean
  },
) {
  return trace(novelId, {
    eventType: "agent-complete",
    agent,
    chapter: opts.chapter,
    beatIndex: opts.beatIndex,
    llmCallId: opts.llmCallId,
    durationMs: opts.durationMs,
    payload: {
      ...(opts.attempt != null && { attempt: opts.attempt }),
      ...(opts.tokens && { promptTokens: opts.tokens.prompt, completionTokens: opts.tokens.completion }),
      ...(opts.cost != null && { cost: opts.cost }),
      ...(opts.pass != null && { pass: opts.pass }),
    },
  })
}

export function traceAgentFail(
  novelId: string,
  agent: string,
  error: string,
  opts?: { chapter?: number; beatIndex?: number; llmCallId?: number | null; durationMs?: number },
) {
  return trace(novelId, {
    eventType: "agent-fail",
    agent,
    chapter: opts?.chapter,
    beatIndex: opts?.beatIndex,
    llmCallId: opts?.llmCallId,
    durationMs: opts?.durationMs,
    payload: { error },
  })
}

export function tracePhaseChange(novelId: string, from: string, to: string) {
  return trace(novelId, {
    eventType: "phase-change",
    payload: { from, to },
  })
}

// ── LLM call start (persisted — used by the live pipeline view to show the
// in-flight row before agent-complete lands) ────────────────────────────
export function traceLLMCallStart(
  novelId: string,
  opts: {
    agent: string
    chapter?: number
    beatIndex?: number
    attempt?: number
    model: string
    provider: string
    meta?: Record<string, unknown>
  },
) {
  return trace(novelId, {
    eventType: "llm-call-start",
    agent: opts.agent,
    chapter: opts.chapter,
    beatIndex: opts.beatIndex,
    payload: {
      model: opts.model,
      provider: opts.provider,
      ...(opts.attempt != null && { attempt: opts.attempt }),
      ...opts.meta,
    },
  })
}

// ── Per-token broadcast (SSE only — too spammy to persist). The UI streams
// this into the live prose panel. Skip DB entirely. ─────────────────────
export function broadcastLLMToken(
  novelId: string,
  opts: {
    agent: string
    chapter?: number
    beatIndex?: number
    delta: string
  },
) {
  emit(novelId, {
    type: "trace" as any,
    data: {
      eventType: "llm-token",
      agent: opts.agent,
      chapter: opts.chapter,
      beatIndex: opts.beatIndex,
      delta: opts.delta,
    },
    timestamp: new Date().toISOString(),
  })
}
