import { describe, expect, test } from "bun:test"

import {
  renderSemanticJudgeReport,
  summarizeSemanticCells,
} from "./method-pack-planner-semantic-judge"

describe("method-pack-planner-semantic-judge", () => {
  test("only counts preferences that survive AB/BA swap control", () => {
    const stableMethodA = stableCell("method", 5)
    const stableMethodB = stableCell("method", 4)
    const positionBiased = positionBiasedCell()
    const aggregate = summarizeSemanticCells([
      stableMethodA,
      stableMethodB,
      positionBiased,
    ] as any[])

    expect(aggregate.methodWins).toBe(2)
    expect(aggregate.controlWins).toBe(0)
    expect(aggregate.positionBiased).toBe(1)
    expect(aggregate.methodWinRateAll).toBeCloseTo(2 / 3)
    expect(aggregate.verdict).toBe("SEMANTIC-HOLD")
    expect(aggregate.reason).toContain("position-biased")
  })

  test("same-plan calibration failure prevents promotion", () => {
    const aggregate = summarizeSemanticCells([
      stableCell("method", 5),
      stableCell("method", 4),
      stableCell("method", 3),
    ] as any[], [
      calibration(false),
      calibration(false),
      calibration(true),
    ] as any[])

    expect(aggregate.methodWins).toBe(3)
    expect(aggregate.calibrationPassRate).toBeCloseTo(1 / 3)
    expect(aggregate.verdict).toBe("SEMANTIC-HOLD")
    expect(aggregate.reason).toContain("calibration")
  })

  test("renders swap-control details", () => {
    const cells = [stableCell("control", -4)]
    const reportText = renderSemanticJudgeReport({
      generatedAt: "2026-05-07T00:00:00.000Z",
      cohortDir: "output/example",
      outputDir: null,
      model: "deepseek-v4-flash",
      thinking: false,
      maxTokens: 3000,
      minStableDelta: 2,
      cellCount: 1,
      calibrationCount: 0,
      cells: cells as any[],
      calibration: [],
      aggregate: summarizeSemanticCells(cells as any[]),
    })

    expect(reportText).toContain("Method-pack planner semantic judge")
    expect(reportText).toContain("control-vs-method")
    expect(reportText).toContain("method-vs-control")
    expect(reportText).toContain("delta=-4.00")
  })
})

function stableCell(outcome: "method" | "control", delta: number) {
  const winnerFirst = outcome === "method" ? "B" : "A"
  const winnerSecond = outcome === "method" ? "A" : "B"
  return makeCell({
    stableOutcome: outcome,
    winnerFirst,
    winnerSecond,
    deltaFirst: delta,
    deltaSecond: delta,
  })
}

function positionBiasedCell() {
  return makeCell({
    stableOutcome: "position-biased",
    winnerFirst: "A",
    winnerSecond: "A",
    deltaFirst: -5,
    deltaSecond: 5,
  })
}

function makeCell(input: {
  stableOutcome: "method" | "control" | "position-biased"
  winnerFirst: "A" | "B" | "TIE"
  winnerSecond: "A" | "B" | "TIE"
  deltaFirst: number
  deltaSecond: number
}) {
  const passes = [
    pass("control-vs-method", input.winnerFirst, "B", "A", input.deltaFirst),
    pass("method-vs-control", input.winnerSecond, "A", "B", input.deltaSecond),
  ] as const
  const methodDelta = (input.deltaFirst + input.deltaSecond) / 2
  return {
    cellPath: "cell.json",
    diagnosticId: "fixture-a",
    fixturePath: "fixture.json",
    replicate: 0,
    stableOutcome: input.stableOutcome,
    methodWon: input.stableOutcome === "method",
    controlWon: input.stableOutcome === "control",
    tie: false,
    weak: false,
    positionBiased: input.stableOutcome === "position-biased",
    methodScore: 20 + methodDelta,
    controlScore: 20,
    methodDelta,
    confidence: 0.8,
    passes,
  }
}

function pass(
  orientation: "control-vs-method" | "method-vs-control",
  winner: "A" | "B" | "TIE",
  methodSide: "A" | "B",
  controlSide: "A" | "B",
  methodDelta: number,
) {
  const methodScore = 20 + methodDelta
  const controlScore = 20
  const scores = {
    A: score(methodSide === "A" ? methodScore : controlScore),
    B: score(methodSide === "B" ? methodScore : controlScore),
  }
  return {
    orientation,
    planAArmId: "arm-a",
    planBArmId: "arm-b",
    methodSide,
    controlSide,
    winner,
    underlyingWinner: winner === "TIE" ? "tie" : winner === methodSide ? "method" : "control",
    methodScore,
    controlScore,
    methodDelta,
    confidence: 0.8,
    judgment: {
      winner,
      confidence: 0.8,
      scores,
      rationale: "example rationale",
      decisiveEvidence: ["specific story evidence"],
      concerns: { A: [], B: [] },
    },
  }
}

function calibration(passed: boolean) {
  return {
    cellPath: "cell.json",
    diagnosticId: "fixture-a",
    replicate: 0,
    sourceArm: "control",
    winner: passed ? "TIE" : "A",
    passed,
    scoreDelta: passed ? 0 : 4,
    confidence: 0.8,
    judgment: {
      winner: passed ? "TIE" : "A",
      confidence: 0.8,
      scores: { A: score(20), B: score(passed ? 20 : 16) },
      rationale: "calibration",
      decisiveEvidence: [],
      concerns: { A: [], B: [] },
    },
  }
}

function score(total: number) {
  const base = Math.max(1, Math.min(5, Math.floor(total / 5)))
  return {
    characterAgency: base,
    causalMomentum: base,
    worldAsEngine: base,
    endpointForce: base,
    proseReadiness: base,
    total,
  }
}
