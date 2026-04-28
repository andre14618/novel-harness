/**
 * Unit tests for `runSettleLoop` — the four-outcome shell that the
 * plan-check + validation paths in drafting.ts share via D3.
 */

import { describe, it, expect } from "bun:test"
import { runSettleLoop, type SettleLoopInput } from "./settle-loop"

interface FakeCheck {
  pass: boolean
  failingBeats: number[]
}

function makeInput(overrides: Partial<SettleLoopInput<FakeCheck>>): SettleLoopInput<FakeCheck> {
  return {
    check: async () => ({ pass: true, failingBeats: [] }),
    isPass: r => r.pass,
    route: r => new Map(r.failingBeats.map(b => [b, ["fix me"]])),
    rewriteBeat: async () => "rewritten",
    budget: 2,
    canSettle: () => true,
    ...overrides,
  }
}

describe("runSettleLoop — outcome variants", () => {
  it("ineligible when canSettle returns false", async () => {
    const out = await runSettleLoop(makeInput({ canSettle: () => false }))
    expect(out.kind).toBe("ineligible")
  })

  it("accepted on initial pass", async () => {
    const out = await runSettleLoop(makeInput({
      initialResult: { pass: true, failingBeats: [] },
    }))
    expect(out.kind).toBe("accepted")
    if (out.kind === "accepted") expect(out.passes).toBe(0)
  })

  it("accepted after one rewrite pass when recheck passes", async () => {
    let checkCalls = 0
    const out = await runSettleLoop(makeInput({
      initialResult: { pass: false, failingBeats: [0, 1] },
      check: async () => {
        checkCalls++
        return { pass: true, failingBeats: [] }
      },
    }))
    expect(out.kind).toBe("accepted")
    if (out.kind === "accepted") expect(out.passes).toBe(1)
    expect(checkCalls).toBe(1)
  })

  it("exhausted when budget hit before recheck passes", async () => {
    const out = await runSettleLoop(makeInput({
      budget: 2,
      initialResult: { pass: false, failingBeats: [0] },
      check: async () => ({ pass: false, failingBeats: [0] }),
    }))
    expect(out.kind).toBe("exhausted")
    if (out.kind === "exhausted") expect(out.passes).toBe(2)
  })

  it("no-routing when route returns empty map on a failing result", async () => {
    const out = await runSettleLoop(makeInput({
      initialResult: { pass: false, failingBeats: [] },
      route: () => new Map(),
    }))
    expect(out.kind).toBe("no-routing")
    if (out.kind === "no-routing") expect(out.passes).toBe(0)
  })
})

describe("runSettleLoop — sequential ascending order contract", () => {
  it("dispatches rewriteBeat in ascending beat-index order", async () => {
    const order: number[] = []
    await runSettleLoop(makeInput({
      initialResult: { pass: false, failingBeats: [3, 1, 5, 0] },
      check: async () => ({ pass: true, failingBeats: [] }),
      rewriteBeat: async (bi) => {
        order.push(bi)
        return "rewritten"
      },
    }))
    expect(order).toEqual([0, 1, 3, 5])
  })

  it("calls rewriteBeat sequentially (awaits each before next)", async () => {
    const events: string[] = []
    await runSettleLoop(makeInput({
      initialResult: { pass: false, failingBeats: [0, 1, 2] },
      check: async () => ({ pass: true, failingBeats: [] }),
      rewriteBeat: async (bi) => {
        events.push(`start-${bi}`)
        await new Promise(r => setTimeout(r, 5))
        events.push(`end-${bi}`)
        return "rewritten"
      },
    }))
    expect(events).toEqual(["start-0", "end-0", "start-1", "end-1", "start-2", "end-2"])
  })
})

describe("runSettleLoop — telemetry hooks", () => {
  it("onIteration fires for rechecks only when initialResult is provided", async () => {
    const passes: number[] = []
    await runSettleLoop(makeInput({
      initialResult: { pass: false, failingBeats: [0] },
      check: async () => ({ pass: false, failingBeats: [0] }),
      budget: 2,
      onIteration: async (passNumber) => { passes.push(passNumber) },
    }))
    // initialResult was provided → onIteration(0, …) is NOT fired (caller
    // owns the initial trace); rechecks at pass 1 and pass 2 do fire.
    expect(passes).toEqual([1, 2])
  })

  it("onIteration fires for initial (passNumber=0) when initialResult omitted", async () => {
    const passes: number[] = []
    let firstCall = true
    await runSettleLoop(makeInput({
      check: async () => {
        if (firstCall) { firstCall = false; return { pass: false, failingBeats: [0] } }
        return { pass: false, failingBeats: [0] }
      },
      budget: 1,
      onIteration: async (passNumber) => { passes.push(passNumber) },
    }))
    // No initialResult → loop calls check() initially and fires onIteration(0,…),
    // then one recheck at pass 1.
    expect(passes).toEqual([0, 1])
  })

  it("onPassStart fires once per rewrite pass with the routed perBeat map", async () => {
    const events: Array<{ pass: number; size: number; keys: number[] }> = []
    await runSettleLoop(makeInput({
      initialResult: { pass: false, failingBeats: [2, 0, 1] },
      check: async () => ({ pass: true, failingBeats: [] }),
      budget: 2,
      onPassStart: async (passNumber, perBeat) => {
        events.push({
          pass: passNumber,
          size: perBeat.size,
          keys: [...perBeat.keys()].sort((a, b) => a - b),
        })
      },
    }))
    // One rewrite pass before the passing recheck.
    expect(events).toEqual([{ pass: 1, size: 3, keys: [0, 1, 2] }])
  })

  it("onSettleComplete fires exactly once with the terminal outcome", async () => {
    const outcomes: string[] = []
    await runSettleLoop(makeInput({
      initialResult: { pass: false, failingBeats: [0] },
      check: async () => ({ pass: true, failingBeats: [] }),
      onSettleComplete: async (outcome) => { outcomes.push(outcome.kind) },
    }))
    expect(outcomes).toEqual(["accepted"])
  })

  it("onSettleComplete fires for ineligible (loop never ran)", async () => {
    const outcomes: string[] = []
    await runSettleLoop(makeInput({
      canSettle: () => false,
      onSettleComplete: async (outcome) => { outcomes.push(outcome.kind) },
    }))
    expect(outcomes).toEqual(["ineligible"])
  })

  it("onSettleComplete fires for no-routing", async () => {
    const outcomes: string[] = []
    await runSettleLoop(makeInput({
      initialResult: { pass: false, failingBeats: [] },
      route: () => new Map(),
      onSettleComplete: async (outcome) => { outcomes.push(outcome.kind) },
    }))
    expect(outcomes).toEqual(["no-routing"])
  })
})

describe("runSettleLoop — initialResult vs check", () => {
  it("uses initialResult when provided; check called only for rechecks", async () => {
    let checkCalls = 0
    await runSettleLoop(makeInput({
      initialResult: { pass: false, failingBeats: [0] },
      check: async () => {
        checkCalls++
        return { pass: true, failingBeats: [] }
      },
    }))
    expect(checkCalls).toBe(1) // recheck only
  })

  it("calls check for initial when initialResult omitted", async () => {
    let checkCalls = 0
    await runSettleLoop(makeInput({
      check: async () => {
        checkCalls++
        return { pass: true, failingBeats: [] }
      },
    }))
    expect(checkCalls).toBe(1) // initial only (passes immediately, no recheck)
  })
})
