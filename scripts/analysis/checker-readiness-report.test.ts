import { describe, expect, test } from "bun:test"
import { buildPlanReadinessDraftsFromAggregate } from "../../src/harness/plan-readiness"
import {
  buildCheckerReadinessAggregate,
  parseArgs,
} from "./checker-readiness-report"
import type { CheckerWarningReport } from "./checker-warning-report"

describe("checker-readiness-report", () => {
  test("parseArgs requires a novel and parses output flags", () => {
    expect(() => parseArgs([])).toThrow("--novel is required")
    expect(parseArgs([
      "--novel", "n",
      "--output", "report.md",
      "--json", "report.json",
      "--import-readiness",
      "--include-warnings",
    ])).toEqual({
      novelId: "n",
      outputPath: "report.md",
      jsonPath: "report.json",
      importReadiness: true,
      includeWarnings: true,
    })
  })

  test("buildCheckerReadinessAggregate converts non-positive blockers into chapter readiness groups", () => {
    const aggregate = buildCheckerReadinessAggregate({
      report: report({
        severity: "blocker",
        source: "continuity-facts",
        description: "Draft says the debt is sovereign, but the plan says Halric's ruin is personal.",
        polarity: "ambiguous",
      }),
      chapterTargets: [{ chapterNumber: 2, chapterId: "ch-002-chancellor-s-arithmetic" }],
      generatedAt: "2026-05-10T00:00:00.000Z",
    })

    expect(aggregate.groupCount).toBe(1)
    const group = aggregate.groups[0]!
    expect(group.chapterId).toBe("ch-002-chancellor-s-arithmetic")
    expect(group.rewritePacket.proposalCandidate.target).toEqual({
      kind: "chapter_outline",
      ref: "ch-002-chancellor-s-arithmetic",
      fieldPath: "purpose",
    })
    expect(group.findings[0]?.label).toBe("CONTINUITY-BLOCKER")
    expect(group.findings[0]?.dimension).toBe("planConsistency")

    const readiness = buildPlanReadinessDraftsFromAggregate({
      novelId: "novel",
      aggregate,
      targetVersions: {
        "chapter_outline:ch-002-chancellor-s-arithmetic": "a".repeat(64),
      },
    })
    expect(readiness.skipped).toHaveLength(0)
    expect(readiness.drafts).toHaveLength(1)
    expect(readiness.drafts[0]?.target).toEqual({
      kind: "chapter_outline",
      ref: "ch-002-chancellor-s-arithmetic",
      fieldPath: "purpose",
    })
  })

  test("buildCheckerReadinessAggregate skips positive and warning items by default", () => {
    const base = report(
      {
        severity: "warning",
        source: "continuity-facts",
        description: "Draft omits a minor continuity detail.",
        polarity: "ambiguous",
      },
      {
        severity: "blocker",
        source: "continuity-facts",
        description: "This is consistent with the plan.",
        polarity: "positive",
      },
    )

    expect(buildCheckerReadinessAggregate({
      report: base,
      chapterTargets: [{ chapterNumber: 2, chapterId: "ch-002" }],
    }).groupCount).toBe(0)

    expect(buildCheckerReadinessAggregate({
      report: base,
      chapterTargets: [{ chapterNumber: 2, chapterId: "ch-002" }],
      includeWarnings: true,
    }).groupCount).toBe(1)
  })
})

function report(...items: Array<Partial<CheckerWarningReport["chapters"][number]["items"][number]>>): CheckerWarningReport {
  return {
    novelId: "novel",
    totalItems: items.length,
    bySeverity: {},
    byPolarity: { negative: 0, positive: 0, ambiguous: 0 },
    byCalibration: { standard: 0, "low-confidence": 0 },
    chapters: [{
      chapter: 2,
      items: items.map((item, index) => ({
        source: "continuity-facts",
        severity: "blocker",
        description: "issue",
        polarity: "negative",
        calibration: "standard",
        chapter: 2,
        rowId: index + 1,
        ...item,
      })),
    }],
  }
}
