import { describe, expect, test } from "bun:test"

import {
  buildPlanReadinessDraftsFromAggregate,
  readinessTargetKey,
} from "./plan-readiness"

describe("plan readiness aggregate import", () => {
  test("turns aggregate findings into stable readiness drafts", () => {
    const result = buildPlanReadinessDraftsFromAggregate({
      novelId: "novel-1",
      aggregate: aggregate(),
      targetVersions: {
        "scene_plan:scn-001-01": "a".repeat(64),
      },
      importedByKind: "test",
      importedByRef: "unit",
    })

    expect(result.skipped).toHaveLength(0)
    expect(result.drafts).toHaveLength(2)
    expect(result.drafts.map(draft => draft.diagnosticLabel).sort()).toEqual(["MATERIAL-1", "WFACT-1"])

    const first = result.drafts[0]!
    expect(first.id).toMatch(/^readiness-[0-9a-f]{32}$/)
    expect(first.target).toEqual({
      kind: "scene_plan",
      ref: "scn-001-01",
      fieldPath: "description",
    })
    expect(first.sourceHash).toBe("a".repeat(64))
    expect(first.sourceHashKind).toBe("target_current_version")
    expect(first.preserveIds).toEqual({
      obligationIds: ["obl-1"],
      characterIds: ["char-hero", "char-rival"],
      worldFactIds: ["world-oath-road"],
      sceneTurnIds: ["turn-choice-1"],
      threadIds: ["thread-main"],
      promiseIds: ["debt-main"],
      payoffIds: ["payoff-main"],
      sourceIds: [],
    })
    expect(first.importedByKind).toBe("test")
    expect(first.importedByRef).toBe("unit")
    expect(first.metadata.aggregateGroupId).toBe("001")
  })

  test("falls back to diagnostic excerpt hashes when current target version is unavailable", () => {
    const result = buildPlanReadinessDraftsFromAggregate({
      novelId: "novel-1",
      aggregate: aggregate(),
    })

    expect(result.drafts[0]!.sourceHash).toMatch(/^[0-9a-f]{64}$/)
    expect(result.drafts[0]!.sourceHashKind).toBe("diagnostic_excerpt")
  })

  test("skips unsupported targets", () => {
    const report = aggregate()
    report.groups[0]!.rewritePacket.proposalCandidate.target.kind = "world_bible"
    const result = buildPlanReadinessDraftsFromAggregate({
      novelId: "novel-1",
      aggregate: report,
    })

    expect(result.drafts).toHaveLength(0)
    expect(result.skipped[0]!.reason).toContain("unsupported")
  })

  test("formats target keys for target-version lookup", () => {
    expect(readinessTargetKey({ kind: "chapter_outline", ref: "ch-001" })).toBe("chapter_outline:ch-001")
    expect(readinessTargetKey({ kind: "scene_plan", ref: "scn-001-01" })).toBe("scene_plan:scn-001-01")
  })
})

function aggregate() {
  return {
    sourceReports: ["/tmp/report.json"],
    groups: [
      {
        groupId: "001",
        fixtureId: "fixture",
        armId: "test:method",
        methodPackEnabled: true,
        unitType: "scene",
        chapterId: "ch-001",
        sceneId: "scn-001-01",
        sourceIds: {
          obligationIds: ["obl-1"],
          characterIds: ["char-hero", "char-rival"],
          worldFactIds: ["world-oath-road"],
        },
        rewritePacket: {
          preserveIds: {
            obligationIds: ["obl-1"],
            characterIds: ["char-hero", "char-rival"],
            worldFactIds: ["world-oath-road"],
            sceneTurnIds: ["turn-choice-1"],
            threadIds: ["thread-main"],
            promiseIds: ["debt-main"],
            payoffIds: ["payoff-main"],
          },
          proposalCandidate: {
            target: {
              kind: "scene_plan",
              ref: "scn-001-01",
              fieldPath: "description",
            },
          },
        },
        findings: [
          {
            findingId: "001.1",
            sourceReport: "/tmp/report.json",
            promptMode: "evidence-first",
            dimension: "characterMateriality",
            label: "MATERIAL-1",
            severity: "medium",
            fixIntent: "make_required_character_material_or_remove_requirement",
            rationale: "required character is present but not material",
            missingForNextLevel: "make the character change the outcome",
            evidence: { excerpt: "rival watches" },
          },
          {
            findingId: "001.2",
            sourceReport: "/tmp/report.json",
            promptMode: "evidence-first",
            dimension: "worldFactPressure",
            label: "WFACT-1",
            severity: "medium",
            fixIntent: "make_world_fact_operational_or_remove_requirement",
            rationale: "world fact is named but not operational",
            missingForNextLevel: "make the road constrain the action",
            evidence: { worldFact: "oath road" },
          },
        ],
        excerpt: "Scene: scn-001-01\nRequired character IDs: char-hero, char-rival",
      },
    ],
  }
}
