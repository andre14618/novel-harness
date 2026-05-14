import { describe, expect, test } from "bun:test"
import {
  buildCheckerWarningReport,
  classifyFindingPolarity,
  classifyTelemetryWeight,
  filterCheckerInputsToFinalAttempts,
  renderCheckerWarningReport,
  type ContinuityCallRow,
  type FunctionalEventRow,
} from "./checker-warning-report"

describe("checker-warning-report", () => {
  test("groups functional warnings with stable refs", () => {
    const functionalEvents: FunctionalEventRow[] = [{
      id: 5,
      chapter: 1,
      payload: {
        warnings: [{
          severity: "warning",
          beat_index: 2,
          beatId: "ch-001-beat-003",
          plannedItemId: "fact-1",
          description: "supported fact is only implied",
        }],
        blockers: [],
      },
    }]

    const report = buildCheckerWarningReport({ functionalEvents }, "novel-warn")

    expect(report).toMatchObject({
      novelId: "novel-warn",
      totalItems: 1,
      bySeverity: { warning: 1 },
      chapters: [{
        chapter: 1,
        items: [{
          source: "functional-check",
          severity: "warning",
          chapter: 1,
          beatIndex: 2,
          beatId: "ch-001-beat-003",
          plannedItemId: "fact-1",
          calibration: "standard",
          telemetryWeight: "noise",
          telemetryWeightReason: "positive-or-supportive-finding",
          description: "supported fact is only implied",
        }],
      }],
    })

    const rendered = renderCheckerWarningReport(report)
    expect(rendered).toContain("Checker warning report for novel-warn")
    expect(rendered).toContain("functional-check beat 3 [ch-001-beat-003] planned=fact-1")
  })

  test("normalizes continuity state location blockers to warning class", () => {
    const continuityRows: ContinuityCallRow[] = [{
      id: 7,
      agent: "continuity-state",
      chapter: 2,
      attempt: 1,
      response_content: JSON.stringify({
        violations: [{
          character: "Maret",
          type: "location",
          severity: "blocker",
          evidence: "Maret begins in the office.",
          reasoning: "Prior state had her in the archive.",
        }],
      }),
    }, {
      id: 8,
      agent: "continuity-facts",
      chapter: 2,
      attempt: 1,
      response_content: JSON.stringify({
        contradictions: [{
          fact: "fact-iron-bars",
          severity: "nit",
          evidence: "She strains with the latch.",
          reasoning: "Strength portrayal is slightly inconsistent.",
        }],
      }),
    }]

    const report = buildCheckerWarningReport({ continuityRows })

    expect(report.totalItems).toBe(2)
    expect(report.bySeverity).toEqual({ warning: 1, nit: 1 })
    expect(report.byCalibration).toEqual({ standard: 1, "low-confidence": 1 })
    expect(report.byTelemetryWeight).toEqual({ "weight-bearing": 0, advisory: 1, noise: 1 })
    expect(report.chapters[0]!.items.map(item => item.source)).toEqual([
      "continuity-state",
      "continuity-facts",
    ])
    expect(renderCheckerWarningReport(report)).toContain("[warning] continuity-state attempt=1 calibration=low-confidence")
  })

  test("marks consistency-shaped blocker rows as positive polarity", () => {
    const continuityRows: ContinuityCallRow[] = [{
      id: 11,
      agent: "continuity-facts",
      chapter: 2,
      attempt: 1,
      response_content: JSON.stringify({
        contradictions: [{
          fact: "assessment scheduled for dawn",
          severity: "blocker",
          evidence: "He had scheduled the physical assessment for dawn.",
          reasoning: "The draft confirms the assessment is scheduled for dawn, consistent with the fact.",
        }, {
          fact: "witness required when requested",
          severity: "blocker",
          evidence: "It requires no witness.",
          reasoning: "The draft states verification requires no witness, contradicting the fact.",
        }],
      }),
    }]

    const report = buildCheckerWarningReport({ continuityRows }, "novel-continuity")

    expect(report.bySeverity).toEqual({ blocker: 2 })
    expect(report.byPolarity).toEqual({ negative: 1, positive: 1, ambiguous: 0 })
    expect(report.byCalibration).toEqual({ standard: 2, "low-confidence": 0 })
    expect(report.byTelemetryWeight).toEqual({ "weight-bearing": 1, advisory: 0, noise: 1 })
    expect(report.chapters[0]!.items.map(item => item.polarity).sort()).toEqual(["negative", "positive"])
    expect(renderCheckerWarningReport(report)).toContain("polarity=positive")
  })

  test("skips non-actionable continuity classifications", () => {
    const continuityRows: ContinuityCallRow[] = [{
      id: 21,
      agent: "continuity-facts",
      chapter: 3,
      attempt: 1,
      response_content: JSON.stringify({
        contradictions: [{
          fact: "salvage requires witness or bronze token",
          severity: "blocker",
          classification: "contextual_narrowing",
          evidence: "No witness. No bronze token.",
          reasoning: "Kael needs a witness because the bronze-token path is unavailable.",
        }, {
          fact: "bronze tokens are valid",
          severity: "blocker",
          classification: "logical_contradiction",
          evidence: "Bronze tokens never count.",
          reasoning: "The draft denies the bronze-token alternative.",
        }],
      }),
    }]

    const report = buildCheckerWarningReport({ continuityRows }, "novel-continuity")

    expect(report.totalItems).toBe(1)
    expect(report.chapters[0]?.items[0]?.description).toBe("The draft denies the bronze-token alternative.")
  })

  test("filters checker inputs to final accepted attempts when attempt is available", () => {
    const functionalEvents: FunctionalEventRow[] = [
      { id: 1, chapter: 2, attempt: 1, payload: { warnings: [] } },
      { id: 2, chapter: 2, attempt: 2, payload: { warnings: [] } },
      { id: 3, chapter: 3, payload: { warnings: [] } },
    ]
    const continuityRows: ContinuityCallRow[] = [
      { id: 4, agent: "continuity-facts", chapter: 2, attempt: 1, response_content: "{}" },
      { id: 5, agent: "continuity-facts", chapter: 2, attempt: 2, response_content: "{}" },
      { id: 6, agent: "continuity-facts", chapter: 3, attempt: null, response_content: "{}" },
    ]

    const filtered = filterCheckerInputsToFinalAttempts(
      { functionalEvents, continuityRows },
      new Map([[2, { attempt: 2 }], [3, { attempt: 1 }]]),
    )

    expect(filtered.functionalEvents.map(row => row.id)).toEqual([2, 3])
    expect(filtered.continuityRows.map(row => row.id)).toEqual([5, 6])
  })

  test("filters final accepted attempts by run id when the approval trace provides it", () => {
    const functionalEvents: FunctionalEventRow[] = [
      { id: 1, runId: 10, chapter: 2, attempt: 1, payload: { warnings: [] } },
      { id: 2, runId: 11, chapter: 2, attempt: 1, payload: { warnings: [] } },
    ]
    const continuityRows: ContinuityCallRow[] = [
      { id: 3, runId: 10, agent: "continuity-facts", chapter: 2, attempt: 1, response_content: "{}" },
      { id: 4, runId: 11, agent: "continuity-facts", chapter: 2, attempt: 1, response_content: "{}" },
    ]

    const filtered = filterCheckerInputsToFinalAttempts(
      { functionalEvents, continuityRows },
      new Map([[2, { attempt: 1, runId: 11 }]]),
    )

    expect(filtered.functionalEvents.map(row => row.id)).toEqual([2])
    expect(filtered.continuityRows.map(row => row.id)).toEqual([4])
  })

  test("classifies explicit non-contradictions as positive polarity", () => {
    expect(classifyFindingPolarity("The draft does not contradict this fact.")).toBe("positive")
    expect(classifyFindingPolarity("The draft states the rule changed, contradicting the fact.")).toBe("negative")
    expect(classifyFindingPolarity("The draft may be underspecified.")).toBe("ambiguous")
    expect(classifyFindingPolarity("The draft does not explicitly state he knows the key is false.")).toBe("ambiguous")
  })

  test("classifies support echoes as positive or ambiguous rather than negative", () => {
    expect(classifyFindingPolarity(
      "Doryn confirms the seal cannot be opened from inside, but the planned state specifies she knows 'seal is locked' which is supported.",
    )).toBe("positive")
    expect(classifyFindingPolarity(
      "Pell demonstrates knowledge of the seal's locking mechanism, supporting that he knows it is locked.",
    )).toBe("positive")
    expect(classifyFindingPolarity(
      "Pell is present when the messenger delivers the order, so he likely knows it, but the prose does not explicitly state his knowledge.",
    )).toBe("ambiguous")
  })

  test("does not treat positive wording inside a violation as support echo", () => {
    expect(classifyFindingPolarity(
      "Vael acknowledges Sable's existence, all direct violations of the rule that teachers ignore Sable.",
    )).toBe("ambiguous")
    expect(classifyFindingPolarity(
      "Aldric's own words confirm his daughter is still sick, but the fact states she is recovering.",
    )).toBe("ambiguous")
  })

  test("classifies telemetry weight separately from raw checker count", () => {
    expect(classifyTelemetryWeight({
      source: "continuity-facts",
      severity: "blocker",
      description: "The draft contradicts the planned fact.",
      polarity: "negative",
      calibration: "standard",
    })).toEqual({
      telemetryWeight: "weight-bearing",
      telemetryWeightReason: "negative-standard-blocker",
    })
    expect(classifyTelemetryWeight({
      source: "functional-check",
      severity: "warning",
      description: "knowledge_missing: The draft does not explicitly state he knows the route.",
      polarity: "negative",
      calibration: "standard",
    })).toEqual({
      telemetryWeight: "noise",
      telemetryWeightReason: "explicitness-only-gap",
    })
    expect(classifyTelemetryWeight({
      source: "continuity-state",
      severity: "warning",
      description: "Maret location violation: she may be elsewhere.",
      polarity: "negative",
      calibration: "low-confidence",
    })).toEqual({
      telemetryWeight: "noise",
      telemetryWeightReason: "low-confidence-calibration",
    })
  })
})
