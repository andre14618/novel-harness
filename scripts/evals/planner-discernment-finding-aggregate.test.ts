import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, test } from "bun:test"

import { buildFindingAggregate, renderFindingAggregate } from "./planner-discernment-finding-aggregate"

describe("planner-discernment-finding-aggregate", () => {
  test("groups selected findings into proposal-ready rewrite packets", () => {
    const dir = mkdtempSync(join(tmpdir(), "planner-discernment-finding-aggregate-"))
    const reportPath = join(dir, "planner-discernment-real-data-report.json")
    writeFileSync(reportPath, JSON.stringify(report(), null, 2))

    const aggregate = buildFindingAggregate({
      reports: [reportPath],
      labels: ["MATERIAL-1", "WFACT-1", "MOTIVE-1"],
      outputDir: null,
      limit: null,
      json: false,
    }, "2026-05-07T00:00:00.000Z")

    expect(aggregate.groupCount).toBe(2)
    expect(aggregate.findingCount).toBe(3)

    const sceneGroup = aggregate.groups.find(group => group.sceneId === "scn-001-01")
    expect(sceneGroup).toBeDefined()
    expect(sceneGroup!.findings.map(finding => finding.label).sort()).toEqual(["MATERIAL-1", "WFACT-1"])
    expect(sceneGroup!.fixIntents).toContain("make_required_character_material_or_remove_requirement")
    expect(sceneGroup!.fixIntents).toContain("make_world_fact_operational_or_remove_requirement")
    expect(sceneGroup!.sourceIds.characterIds).toEqual(["char-hero", "char-rival"])
    expect(sceneGroup!.sourceIds.worldFactIds).toEqual(["world-oath-road"])
    expect(sceneGroup!.rewritePacket.proposalCandidate).toMatchObject({
      target: { kind: "scene_plan", ref: "scn-001-01", fieldPath: "description" },
      requiresProposedValue: true,
      proposedValueStatus: "semantic_rewrite_required",
      safeToAutoApply: false,
    })

    const chapterGroup = aggregate.groups.find(group => group.sceneId === null)
    expect(chapterGroup).toBeDefined()
    expect(chapterGroup!.rewritePacket.proposalCandidate.target).toEqual({
      kind: "chapter_outline",
      ref: "ch-001",
      fieldPath: "purpose",
    })

    const rendered = renderFindingAggregate(aggregate)
    expect(rendered).toContain("Proposal candidate")
    expect(rendered).toContain("semantic_rewrite_required")
    expect(rendered).toContain("Preserve IDs")
  })
})

function report() {
  return {
    promptMode: "evidence-first",
    results: [
      sceneResult("characterMateriality", "MATERIAL-1"),
      sceneResult("worldFactPressure", "WFACT-1"),
      sceneResult("motivationSpecificity", "MOTIVE-3"),
      {
        dimension: "motivationSpecificity",
        label: "MOTIVE-1",
        armId: "control:no-method:flash",
        methodPackEnabled: false,
        fixtureId: "fixture",
        chapterId: "ch-001",
        text: [
          "Parent chapter: ch-001; function=generic chapter motion.",
          "Required obligation IDs: obl-ch-001",
          "Required character IDs: char-hero",
          "Required world fact IDs: none",
        ].join("\n"),
        output: {
          evidence: { motivation: "generic plot motion" },
          missingForNextLevel: "needs a character-specific motive",
        },
      },
    ],
  }
}

function sceneResult(dimension: string, label: string) {
  return {
    dimension,
    label,
    armId: "test:method",
    methodPackEnabled: true,
    fixtureId: "fixture",
    chapterId: "ch-001",
    sceneId: "scn-001-01",
    requiredCharacterIds: ["char-hero", "char-rival"],
    requiredWorldFactIds: ["world-oath-road"],
    text: [
      "Scene: scn-001-01",
      "Scene function: force the hero onto an oath-bound road.",
      "Required obligation IDs: obl-001-01, obl-001-02",
      "Required character IDs: char-hero, char-rival",
      "Required world fact IDs: world-oath-road",
    ].join("\n"),
    output: {
      evidence: { excerpt: "the required item is present but not operational" },
      missingForNextLevel: "needs material pressure on the scene outcome",
    },
  }
}
