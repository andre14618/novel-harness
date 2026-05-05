import { expect, test } from "bun:test"

import { normalize } from "./normalize"
import type { RawSnapshot } from "./db-snapshot"

test("pipeline event normalization ignores wall-clock duration and parallel insertion order", () => {
  const first = snapshot([
    event({ id: 1, event_type: "agent-complete", agent: "adherence-events", beat_index: 1, duration_ms: 250, payload: { result: "ok" } }),
    event({ id: 2, event_type: "llm-call-start", agent: "halluc-ungrounded", beat_index: 1, duration_ms: null, payload: { start: true } }),
    event({ id: 3, event_type: "phase-complete", agent: null, beat_index: null, duration_ms: 1000, payload: { phase: "drafting" } }),
  ])
  const second = snapshot([
    event({ id: 30, event_type: "phase-complete", agent: null, beat_index: null, duration_ms: 10, payload: { phase: "drafting" } }),
    event({ id: 10, event_type: "llm-call-start", agent: "halluc-ungrounded", beat_index: 1, duration_ms: null, payload: { start: true } }),
    event({ id: 20, event_type: "agent-complete", agent: "adherence-events", beat_index: 1, duration_ms: 5, payload: { result: "ok" } }),
  ])

  expect(normalize(first).tables.pipeline_events).toEqual(normalize(second).tables.pipeline_events)
  expect(normalize(first).tables.pipeline_events[0]?.duration_ms).toBe("<DURATION>")
})

function snapshot(events: Array<Record<string, unknown>>): RawSnapshot {
  return {
    novelId: "phase-parity-smoke",
    capturedAt: "2026-05-05T00:00:00.000Z",
    tables: { pipeline_events: events },
  }
}

function event(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 0,
    novel_id: "phase-parity-smoke",
    run_id: null,
    chapter: 1,
    beat_index: null,
    event_type: "agent-complete",
    agent: null,
    llm_call_id: null,
    duration_ms: 0,
    payload: {},
    timestamp: "2026-05-05T00:00:00.000Z",
    ...overrides,
  }
}
