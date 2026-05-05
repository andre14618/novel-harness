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
    expect(joined).toHaveLength(2)
    expect(joined[0]!.label).toBe("TP")
    expect(joined[0]!.subcategory).toBe("object_emphasis")
    expect(joined[1]!.label).toBeNull()
    expect(joined[1]!.subcategory).toBeNull()
  })

  test("buildAggregate computes per-stratum and per-subcategory rates", () => {
    const findings: AggregatedFinding[] = [
      makeAggregated("1", "continuity-facts", "blocker", "TP", "object_emphasis"),
      makeAggregated("2", "continuity-facts", "blocker", "FP", "object_emphasis"),
      makeAggregated("3", "continuity-facts", "warning", "AMB", "other"),
      makeAggregated("4", "continuity-state", "warning", "TP", "other"),
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
): AggregatedFinding {
  return {
    ...makePanelRecord(id, agent, severity, "subject"),
    label,
    subcategory,
    rationale: label ? "rationale" : null,
  }
}
