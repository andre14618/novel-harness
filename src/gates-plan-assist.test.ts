/**
 * Scaffolding tests for the plan-assist gate — docs/exhaustion-handler-design.md
 * §"Path (A)+(B)" + §"Auto-mode behavior". Covers request/resolve roundtrip
 * for each decision variant, auto-mode throw shape, and unknown-gate resolve
 * behavior.
 *
 * No drafting.ts / pipeline callers yet — those wire in at step 3.
 */
import { test, expect, mock } from "bun:test"

// events.ts does not touch DB, but trace() does — stub it so the test
// doesn't require a live connection.
mock.module("./trace", () => ({ trace: async () => {} }))

import {
  requestPlanAssist,
  resolvePlanAssist,
  getPendingPlanAssist,
  getPendingGate,
  PipelineBailError,
  type PlanAssistGatePayload,
  type PlanAssistDecision,
} from "./gates"

function makePayload(novelId: string, chapter: number): PlanAssistGatePayload {
  return {
    kind: "plan-check-exhausted",
    novelId,
    chapter,
    outline: {
      chapterNumber: chapter,
      title: "Stub Chapter",
      povCharacter: "Alice",
      setting: "Lab",
      purpose: "test",
      targetWords: 1000,
      scenes: [],
      charactersPresent: ["Alice"],
      establishedFacts: [],
      characterStateChanges: [],
      knowledgeChanges: [],
    } as any,
    prose: "Some prose.",
    unresolvedDeviations: [{ description: "stub issue", beat_index: 0 }],
  }
}

test("auto mode throws PipelineBailError with correct shape", () => {
  const payload = makePayload("auto-novel", 1)
  let caught: unknown = null
  try {
    requestPlanAssist(payload, "auto")
  } catch (err) {
    caught = err
  }
  expect(caught).toBeInstanceOf(PipelineBailError)
  const bail = caught as PipelineBailError
  expect(bail.kind).toBe("plan-check-exhausted")
  expect(bail.novelId).toBe("auto-novel")
  expect(bail.chapter).toBe(1)
  expect(bail.payload).toBe(payload)
})

test("web mode — request/resolve with edit-plan decision roundtrips the outline", async () => {
  const payload = makePayload("web-novel-1", 2)
  const promise = requestPlanAssist(payload, "web")

  expect(getPendingPlanAssist("web-novel-1")).not.toBeNull()

  const replacement = { ...payload.outline, title: "Replaced" }
  const decision: PlanAssistDecision = { action: "edit-plan", outline: replacement as any }
  const resolved = resolvePlanAssist("web-novel-1", 2, decision)
  expect(resolved).toBe(true)

  const result = await promise
  expect(result.action).toBe("edit-plan")
  if (result.action === "edit-plan") {
    expect(result.outline.title).toBe("Replaced")
  }

  expect(getPendingPlanAssist("web-novel-1")).toBeNull()
})

test("web mode — override decision roundtrips cleanly", async () => {
  const payload = makePayload("web-novel-2", 3)
  const promise = requestPlanAssist(payload, "web")
  resolvePlanAssist("web-novel-2", 3, { action: "override" })
  const result = await promise
  expect(result.action).toBe("override")
})

test("web mode — abort decision roundtrips cleanly", async () => {
  const payload = makePayload("web-novel-3", 4)
  const promise = requestPlanAssist(payload, "web")
  resolvePlanAssist("web-novel-3", 4, { action: "abort" })
  const result = await promise
  expect(result.action).toBe("abort")
})

test("resolve with unknown (novelId, chapter) returns false", () => {
  const resolved = resolvePlanAssist("no-such-novel", 99, { action: "abort" })
  expect(resolved).toBe(false)
})

test("getPendingGate returns discriminated union for plan-assist", async () => {
  const payload = makePayload("discriminator-novel", 5)
  const promise = requestPlanAssist(payload, "web")

  const gate = getPendingGate("discriminator-novel")
  expect(gate).not.toBeNull()
  expect(gate?.kind).toBe("plan-assist")
  if (gate?.kind === "plan-assist") {
    expect(gate.chapter).toBe(5)
    expect(gate.payload.unresolvedDeviations).toHaveLength(1)
  }

  // Cleanup so the test doesn't leak a pending promise
  resolvePlanAssist("discriminator-novel", 5, { action: "abort" })
  await promise
})

test("getPendingGate returns null when nothing pending", () => {
  expect(getPendingGate("never-requested-novel")).toBeNull()
})
