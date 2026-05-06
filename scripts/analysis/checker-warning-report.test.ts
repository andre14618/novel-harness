import { describe, expect, test } from "bun:test"
import {
  buildCheckerWarningReport,
  classifyFindingPolarity,
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
    expect(report.chapters[0]!.items.map(item => item.source)).toEqual([
      "continuity-state",
      "continuity-facts",
    ])
    expect(renderCheckerWarningReport(report)).toContain("[warning] continuity-state attempt=1")
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
    expect(report.chapters[0]!.items.map(item => item.polarity).sort()).toEqual(["negative", "positive"])
    expect(renderCheckerWarningReport(report)).toContain("polarity=positive")
  })

  test("classifies explicit non-contradictions as positive polarity", () => {
    expect(classifyFindingPolarity("The draft does not contradict this fact.")).toBe("positive")
    expect(classifyFindingPolarity("The draft states the rule changed, contradicting the fact.")).toBe("negative")
    expect(classifyFindingPolarity("The draft may be underspecified.")).toBe("ambiguous")
  })
})
