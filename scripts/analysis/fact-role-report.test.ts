import { describe, expect, test } from "bun:test"
import {
  buildFactRoleReport,
  renderFactRoleReport,
  type CanonFactsRow,
  type FactsRow,
} from "./fact-role-report"

describe("fact-role-report", () => {
  test("buildFactRoleReport totals roles per table and per category/kind", () => {
    const facts: FactsRow[] = [
      { novel_id: "n1", category: "rule", role: "operational" },
      { novel_id: "n1", category: "rule", role: "operational" },
      { novel_id: "n1", category: "physical", role: "reference" },
      { novel_id: "n2", category: "rule", role: "hidden" },
    ]
    const canon: CanonFactsRow[] = [
      { novel_id: "n1", kind: "established_fact", role: "operational", superseded_by_version: null },
      { novel_id: "n1", kind: "established_fact", role: "reference", superseded_by_version: 2 },
      { novel_id: "n1", kind: "promise", role: "hidden", superseded_by_version: null },
    ]

    const report = buildFactRoleReport(facts, canon, null, "2026-05-05T00:00:00Z")

    expect(report.facts.rows).toBe(4)
    expect(report.facts.novels).toBe(2)
    expect(report.facts.totals.operational).toBe(2)
    expect(report.facts.totals.reference).toBe(1)
    expect(report.facts.totals.hidden).toBe(1)
    expect(report.facts.totals.unknown).toBe(0)

    const ruleRow = report.facts.byKey.find((r) => r.key === "rule")!
    expect(ruleRow.counts.operational).toBe(2)
    expect(ruleRow.counts.hidden).toBe(1)

    expect(report.canonFacts.rows).toBe(3)
    expect(report.canonFacts.activeOnly.rows).toBe(2)
    expect(report.canonFacts.activeOnly.totals.reference).toBe(0)
    expect(report.canonFacts.activeOnly.totals.operational).toBe(1)
  })

  test("buildFactRoleReport flags rows whose role value is not in the union", () => {
    const facts: FactsRow[] = [
      { novel_id: "n1", category: "rule", role: "operational" },
      { novel_id: "n1", category: "rule", role: null },
      { novel_id: "n1", category: "rule", role: "garbage" },
    ]
    const report = buildFactRoleReport(facts, [], null, "2026-05-05T00:00:00Z")
    expect(report.facts.totals.unknown).toBe(2)
    expect(report.facts.totals.operational).toBe(1)
  })

  test("renderFactRoleReport produces all three tables and a per-key cross-tab", () => {
    const facts: FactsRow[] = [
      { novel_id: "n1", category: "rule", role: "operational" },
      { novel_id: "n1", category: "physical", role: "reference" },
    ]
    const canon: CanonFactsRow[] = [
      { novel_id: "n1", kind: "established_fact", role: "operational", superseded_by_version: null },
    ]
    const md = renderFactRoleReport(buildFactRoleReport(facts, canon, "n1", "2026-05-05T00:00:00Z"))
    expect(md).toContain("# Fact Role Distribution")
    expect(md).toContain("## facts")
    expect(md).toContain("## canon_facts (all versions)")
    expect(md).toContain("## canon_facts (active only)")
    expect(md).toContain("`rule`")
    expect(md).toContain("`physical`")
    expect(md).toContain("`established_fact`")
    expect(md).toContain("Scope: novel `n1`.")
  })

  test("renderFactRoleReport handles empty data gracefully", () => {
    const md = renderFactRoleReport(buildFactRoleReport([], [], null, "2026-05-05T00:00:00Z"))
    expect(md).toContain("Rows: 0 across 0 novel(s).")
    expect(md).toContain("n/a")
  })
})
