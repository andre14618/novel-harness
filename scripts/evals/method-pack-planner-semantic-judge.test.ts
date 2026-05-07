import { describe, expect, test } from "bun:test"

import {
  renderSemanticJudgeReport,
  summarizeSemanticCells,
} from "./method-pack-planner-semantic-judge"

describe("method-pack-planner-semantic-judge", () => {
  test("aggregates blind pairwise preferences after unblinding", () => {
    const aggregate = summarizeSemanticCells([
      cell({ winner: "A", methodSide: "A", methodScore: 23, controlScore: 18 }),
      cell({ winner: "B", methodSide: "B", methodScore: 22, controlScore: 17 }),
      cell({ winner: "TIE", methodSide: "A", methodScore: 19, controlScore: 19 }),
    ])

    expect(aggregate.methodWins).toBe(2)
    expect(aggregate.controlWins).toBe(0)
    expect(aggregate.ties).toBe(1)
    expect(aggregate.methodWinRate).toBeCloseTo(2 / 3)
    expect(aggregate.verdict).toBe("SEMANTIC-PASS")
  })

  test("renders semantic report without leaking Plan A/B as method/control labels", () => {
    const reportText = renderSemanticJudgeReport({
      generatedAt: "2026-05-07T00:00:00.000Z",
      cohortDir: "output/example",
      outputDir: null,
      model: "deepseek-v4-flash",
      thinking: false,
      maxTokens: 3000,
      cellCount: 1,
      cells: [cell({ winner: "B", methodSide: "A", methodScore: 17, controlScore: 21 })],
      aggregate: summarizeSemanticCells([
        cell({ winner: "B", methodSide: "A", methodScore: 17, controlScore: 21 }),
      ]),
    })

    expect(reportText).toContain("Method-pack planner semantic judge")
    expect(reportText).toContain("control")
    expect(reportText).toContain("delta=-4.00")
  })
})

function cell(input: {
  winner: "A" | "B" | "TIE"
  methodSide: "A" | "B"
  methodScore: number
  controlScore: number
}) {
  const controlSide = input.methodSide === "A" ? "B" : "A"
  const scores = {
    A: score(input.methodSide === "A" ? input.methodScore : input.controlScore),
    B: score(input.methodSide === "B" ? input.methodScore : input.controlScore),
  }
  return {
    cellPath: "cell.json",
    diagnosticId: "fixture-a",
    fixturePath: "fixture.json",
    replicate: 0,
    planAArmId: "hidden-a",
    planBArmId: "hidden-b",
    methodSide: input.methodSide,
    controlSide,
    winner: input.winner,
    methodWon: input.winner === input.methodSide,
    controlWon: input.winner === controlSide,
    tie: input.winner === "TIE",
    methodScore: input.methodScore,
    controlScore: input.controlScore,
    methodDelta: input.methodScore - input.controlScore,
    confidence: 0.8,
    judgment: {
      winner: input.winner,
      confidence: 0.8,
      scores,
      rationale: "example rationale",
      decisiveEvidence: ["specific story evidence"],
      concerns: { A: [], B: [] },
    },
  } as any
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
