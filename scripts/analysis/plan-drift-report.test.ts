import { describe, expect, test } from "bun:test"
import {
  buildPlanDriftReport,
  renderPlanDriftReport,
  type PlanCheckCallRow,
} from "./plan-drift-report"

describe("plan-drift-report", () => {
  test("summarizes failing chapter-plan-checker calls with beat refs", () => {
    const rows: PlanCheckCallRow[] = [
      {
        id: 2,
        chapter: 2,
        attempt: 2,
        response_content: JSON.stringify({ pass: true, deviations: [] }),
      },
      {
        id: 1,
        chapter: 2,
        attempt: 1,
        response_content: JSON.stringify({
          pass: false,
          deviations: [
            {
              description: "Planned registry alteration became an office break-in.",
              beat_index: 3,
              beatId: "ch-002-beat-004-registry",
            },
          ],
        }),
      },
    ]

    const report = buildPlanDriftReport(rows, "novel-test")

    expect(report).toMatchObject({
      novelId: "novel-test",
      totalCalls: 2,
      passingCalls: 1,
      failingCalls: 1,
      parseErrors: 0,
      chapters: [
        {
          chapter: 2,
          totalCalls: 2,
          passingCalls: 1,
          failingCalls: 1,
          finalPass: true,
          finalDeviationCount: 0,
        },
      ],
    })
    expect(report.chapters[0]!.driftCalls[0]!.deviations).toEqual([
      {
        description: "Planned registry alteration became an office break-in.",
        beatIndex: 3,
        beatId: "ch-002-beat-004-registry",
      },
    ])

    const rendered = renderPlanDriftReport(report)
    expect(rendered).toContain("Plan drift report for novel-test")
    expect(rendered).toContain("chapter 2: final=pass")
    expect(rendered).toContain("beat 4 [ch-002-beat-004-registry]")
    expect(rendered).toContain("Planned registry alteration became an office break-in.")
  })

  test("reports malformed checker output without throwing", () => {
    const report = buildPlanDriftReport([
      { id: 10, chapter: 1, attempt: 1, response_content: "not-json" },
    ])

    expect(report.totalCalls).toBe(1)
    expect(report.parseErrors).toBe(1)
    expect(report.chapters[0]!.finalPass).toBeNull()
    expect(report.chapters[0]!.driftCalls[0]!.parseError).toContain("JSON")
    expect(renderPlanDriftReport(report)).toContain("parse error")
  })
})
