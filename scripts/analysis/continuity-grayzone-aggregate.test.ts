import { describe, expect, test } from "bun:test"
import {
  buildAggregate,
  joinLabels,
  parseLabelsJson,
  parsePanelJsonl,
  renderMarkdown,
  type AggregatedFinding,
  type PanelFindingRecord,
} from "./continuity-grayzone-aggregate"

describe("continuity-grayzone-aggregate", () => {
  test("joinLabels merges labels with the panel by findingId and leaves unlabeled findings null", () => {
    const panel = parsePanelJsonl(
      [
        JSON.stringify(makePanelRecord("a", "continuity-facts", "blocker", "object_emphasis-target")),
        JSON.stringify(makePanelRecord("b", "continuity-state", "warning", "other-target")),
      ].join("\n") + "\n",
    )

    const labels = parseLabelsJson(
      JSON.stringify([{ findingId: "a", label: "TP", subcategory: "object_emphasis", rationale: "ok" }]),
    )

    const joined = joinLabels(panel, labels)
    expect(joined.findings).toHaveLength(2)
    expect(joined.findings[0]!.label).toBe("TP")
    expect(joined.findings[0]!.subcategory).toBe("object_emphasis")
    expect(joined.findings[1]!.label).toBeNull()
    expect(joined.findings[1]!.subcategory).toBeNull()
    expect(joined.duplicateLabels).toHaveLength(0)
  })

  test("joinLabels surfaces duplicate findingIds across label files", () => {
    const panel = parsePanelJsonl(
      JSON.stringify(makePanelRecord("a", "continuity-facts", "blocker", "subj")) + "\n",
    )
    const labels = parseLabelsJson(
      JSON.stringify([
        { findingId: "a", label: "TP", subcategory: "object_emphasis", rationale: "first" },
        { findingId: "a", label: "FP", subcategory: "object_emphasis", rationale: "second" },
      ]),
    )

    const joined = joinLabels(panel, labels)
    expect(joined.findings[0]!.label).toBe("FP")
    expect(joined.duplicateLabels).toHaveLength(1)
    expect(joined.duplicateLabels[0]!.findingId).toBe("a")
    expect(joined.duplicateLabels[0]!.labels.map((l) => l.label)).toEqual(["TP", "FP"])
  })

  test("buildAggregate computes per-stratum and per-subcategory rates", () => {
    const findings: AggregatedFinding[] = [
      makeAggregated("1", "continuity-facts", "blocker", "TP", "object_emphasis"),
      makeAggregated("2", "continuity-facts", "blocker", "FP", "object_emphasis", "positive"),
      makeAggregated("3", "continuity-facts", "warning", "AMB", "other"),
      makeAggregated("4", "continuity-state", "warning", "TP", "other", "positive"),
      makeAggregated("5", "continuity-state", "warning", null, null),
    ]

    const aggregate = buildAggregate(findings, "2026-05-05T00:00:00Z")
    expect(aggregate.total.total).toBe(5)
    expect(aggregate.total.tp).toBe(2)
    expect(aggregate.total.fp).toBe(1)
    expect(aggregate.total.amb).toBe(1)
    expect(aggregate.total.unlabeled).toBe(1)

    const stratumKey = (s: { agent: string; severity: string }) => `${s.agent}/${s.severity}`
    const factsBlocker = aggregate.strata.find((s) => stratumKey(s) === "continuity-facts/blocker")!
    expect(factsBlocker.rates.tp).toBe(1)
    expect(factsBlocker.rates.fp).toBe(1)

    const stateWarning = aggregate.strata.find((s) => stratumKey(s) === "continuity-state/warning")!
    expect(stateWarning.rates.unlabeled).toBe(1)

    const objectSub = aggregate.subcategories.find((s) => s.subcategory === "object_emphasis")!
    expect(objectSub.rates.total).toBe(2)

    const positive = aggregate.polarities.find((p) => p.polarity === "positive")!
    expect(positive.rates.total).toBe(2)
    expect(positive.rates.tp).toBe(1)
    expect(positive.rates.fp).toBe(1)
  })

  test("renderMarkdown emits per-stratum and per-subcategory tables", () => {
    const findings: AggregatedFinding[] = [
      makeAggregated("1", "continuity-facts", "blocker", "TP", "object_emphasis"),
      makeAggregated("2", "continuity-facts", "warning", "FP", "other"),
    ]
    const md = renderMarkdown(buildAggregate(findings, "2026-05-05T00:00:00Z"))
    expect(md).toContain("# Continuity Gray-Zone Panel Results")
    expect(md).toContain("Sample size: 2")
    expect(md).toContain("`continuity-facts/blocker`")
    expect(md).toContain("## Per-polarity rates")
    expect(md).toContain("`ambiguous`")
    expect(md).toContain("`object_emphasis`")
    expect(md).toContain("`other`")
  })

  test("parseLabelsJson rejects malformed labels", () => {
    expect(() => parseLabelsJson("not-json")).toThrow()
    expect(() => parseLabelsJson("{}")).toThrow("must be a JSON array")
    expect(() =>
      parseLabelsJson(JSON.stringify([{ findingId: "a", label: "MAYBE", subcategory: "other" }])),
    ).toThrow("must be TP|FP|AMB")
  })
})

function makePanelRecord(
  id: string,
  agent: "continuity-facts" | "continuity-state",
  severity: "blocker" | "warning" | "nit",
  subject: string,
  polarity: "negative" | "positive" | "ambiguous" = "ambiguous",
): PanelFindingRecord {
  return {
    findingId: id,
    agent,
    severity,
    novelId: "novel-x",
    chapter: 1,
    attempt: 1,
    subject,
    evidence: "evidence text",
    reasoning: "reasoning text",
    polarity,
    stateType: agent === "continuity-state" ? "location" : null,
    proseExcerpt: "prose",
    stratum: { agent, severity },
  }
}

function makeAggregated(
  id: string,
  agent: "continuity-facts" | "continuity-state",
  severity: "blocker" | "warning" | "nit",
  label: "TP" | "FP" | "AMB" | null,
  subcategory: string | null,
  polarity: "negative" | "positive" | "ambiguous" = "ambiguous",
): AggregatedFinding {
  return {
    ...makePanelRecord(id, agent, severity, "subject", polarity),
    label,
    subcategory,
    rationale: label ? "rationale" : null,
  }
}
