import { describe, expect, test } from "bun:test"

import {
  buildFactRoleContextPreview,
  renderFactRoleContextPreview,
  type CanonFactContextRow,
  type LegacyFactContextRow,
} from "./fact-role-context-preview"

describe("fact-role-context-preview", () => {
  test("buildFactRoleContextPreview counts writer and continuity policy effects", () => {
    const legacy: LegacyFactContextRow[] = [
      { novel_id: "n1", category: "rule", role: "operational" },
      { novel_id: "n1", category: "rule", role: "reference" },
      { novel_id: "n1", category: "rule", role: "hidden" },
      { novel_id: "n1", category: "place", role: null },
      { novel_id: "n2", category: "place", role: "archival" },
    ]
    const canon: CanonFactContextRow[] = [
      { novel_id: "n1", kind: "established_fact", role: "operational", superseded_by_version: null },
      { novel_id: "n1", kind: "established_fact", role: "reference", superseded_by_version: null },
      { novel_id: "n1", kind: "secret", role: "hidden", superseded_by_version: null },
      { novel_id: "n1", kind: "secret", role: "hidden", superseded_by_version: 7 },
      { novel_id: "n1", kind: "mystery", role: undefined, superseded_by_version: null },
    ]

    const report = buildFactRoleContextPreview(legacy, canon, null, "2026-05-05T00:00:00Z")

    expect(report.legacyFacts.totalRows).toBe(5)
    expect(report.legacyFacts.novels).toBe(2)
    expect(report.legacyFacts.unknownRoleCount).toBe(2)
    expect(report.legacyFacts.writerVisibleCount).toBe(4)
    expect(report.legacyFacts.hiddenExcludedFromWriterCount).toBe(1)
    expect(report.legacyFacts.continuityBlockingCount).toBe(3)
    expect(report.legacyFacts.referenceAdvisoryOnlyCount).toBe(1)
    expect(report.legacyFacts.hiddenExcludedFromContinuityCount).toBe(1)

    expect(report.activeCanonFacts.totalRows).toBe(4)
    expect(report.activeCanonFacts.unknownRoleCount).toBe(1)
    expect(report.activeCanonFacts.writerVisibleCount).toBe(3)
    expect(report.activeCanonFacts.hiddenExcludedFromWriterCount).toBe(1)
    expect(report.activeCanonFacts.continuityBlockingCount).toBe(2)
    expect(report.activeCanonFacts.referenceAdvisoryOnlyCount).toBe(1)
    expect(report.activeCanonFacts.hiddenExcludedFromContinuityCount).toBe(1)
  })

  test("buildFactRoleContextPreview groups legacy categories and active canon kinds", () => {
    const report = buildFactRoleContextPreview(
      [
        { novel_id: "n1", category: "rule", role: "operational" },
        { novel_id: "n1", category: "rule", role: "reference" },
        { novel_id: "n1", category: "place", role: "hidden" },
      ],
      [
        { novel_id: "n1", kind: "established_fact", role: "operational", superseded_by_version: null },
        { novel_id: "n1", kind: "established_fact", role: null, superseded_by_version: null },
        { novel_id: "n1", kind: "archived", role: "hidden", superseded_by_version: 2 },
      ],
      "n1",
      "2026-05-05T00:00:00Z",
    )

    expect(report.legacyFacts.byKey.map((row) => row.key)).toEqual(["rule", "place"])
    expect(report.legacyFacts.byKey[0].counts.referenceAdvisoryOnlyCount).toBe(1)
    expect(report.activeCanonFacts.byKey.map((row) => row.key)).toEqual(["established_fact"])
    expect(report.activeCanonFacts.byKey[0].counts.unknownRoleCount).toBe(1)
    expect(report.activeCanonFacts.byKey[0].counts.continuityBlockingCount).toBe(2)
  })

  test("renderFactRoleContextPreview emits concise markdown tables", () => {
    const report = buildFactRoleContextPreview(
      [
        { novel_id: "n1", category: "rule", role: "operational" },
        { novel_id: "n1", category: "place", role: "hidden" },
      ],
      [
        { novel_id: "n1", kind: "established_fact", role: "reference", superseded_by_version: null },
      ],
      "n1",
      "2026-05-05T00:00:00Z",
    )

    const md = renderFactRoleContextPreview(report)

    expect(md).toContain("# Fact Role Context Preview")
    expect(md).toContain("Scope: novel `n1`.")
    expect(md).toContain("Unknown or missing roles are counted explicitly and previewed as operational.")
    expect(md).toContain("| legacy facts | 2 | 0 | 1 | 1 | 1 | 0 | 1 |")
    expect(md).toContain("## legacy facts by category")
    expect(md).toContain("## active canon_facts by kind")
    expect(md).toContain("`established_fact`")
  })

  test("renderFactRoleContextPreview handles empty data", () => {
    const md = renderFactRoleContextPreview(
      buildFactRoleContextPreview([], [], null, "2026-05-05T00:00:00Z"),
    )

    expect(md).toContain("Scope: all novels.")
    expect(md).toContain("| active canon_facts | 0 | 0 | 0 | 0 | 0 | 0 | 0 |")
    expect(md).toContain("No rows.")
  })
})
