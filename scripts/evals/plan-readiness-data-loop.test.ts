import { describe, expect, test } from "bun:test"

import {
  filterAggregateForCellArm,
  outlinesFromPlannerContractPlan,
  renderLoopReport,
} from "./plan-readiness-data-loop"

describe("plan-readiness-data-loop", () => {
  test("converts scene-first planner contracts into matching outline targets", () => {
    const outlines = outlinesFromPlannerContractPlan(plan() as any)

    expect(outlines).toHaveLength(1)
    expect(outlines[0]!.chapterId).toBe("ch-01")
    expect(outlines[0]!.scenes).toHaveLength(2)
    expect(outlines[0]!.scenes[0]!.beatId).toBe("sc-01-01")
    expect((outlines[0]!.scenes[0] as any).requiredCharacterIds).toEqual([
      "char-mara",
      "char-ashren",
    ])
    expect((outlines[0]!.scenes[0] as any).requiredWorldFactIds).toEqual([
      "world-charter",
    ])
    expect(outlines[0]!.scenes[0]!.obligations.mustEstablish[0]!.obligationId)
      .toBe("obl-01")
  })

  test("filters aggregate groups to the matching fixture arm and rewrites group ids", () => {
    const filtered = filterAggregateForCellArm(aggregate(), "fixture-a", "test:method", 1)

    expect(filtered.groupCount).toBe(1)
    expect(filtered.findingCount).toBe(1)
    expect(filtered.groups[0].groupId).toBe("001")
    expect(filtered.groups[0].findings[0].findingId).toBe("001.1")
    expect(filtered.groups[0].fixtureId).toBe("fixture-a")
    expect(filtered.groups[0].armId).toBe("test:method")
  })

  test("renders outcome summary without claiming quality proof", () => {
    const rendered = renderLoopReport({
      generatedAt: "2026-05-08T00:00:00.000Z",
      novelId: "loop-test",
      source: {
        cellPath: "cell.json",
        fixtureId: "fixture-a",
        armId: "test:method",
        reports: ["report.json"],
        labels: ["REL-1"],
      },
      imported: { inserted: 1, updated: 0, skipped: 0, itemCount: 1 },
      actions: [{
        kind: "proposal",
        itemId: "readiness-1",
        label: "REL-1",
        targetRef: "sc-01-01",
        action: "field_replace",
        proposalEnvelopeId: "proposal-1",
        resolutionStatus: "approved",
      }],
      outcomes: {
        summary: {
          linkedProposalCount: 1,
          appliedProposalCount: 1,
          planningLineageRecordedCount: 1,
          needsDownstreamObservationCount: 1,
          downstreamObservedCount: 0,
        },
      },
      aggregate: { groups: [] },
    })

    expect(rendered).toContain("Plan Readiness Data Loop")
    expect(rendered).toContain("does not prove story-quality improvement")
  })
})

function plan() {
  return {
    armId: "test:method",
    methodPackId: "method",
    templateId: "template",
    chapters: [{
      chapterId: "ch-01",
      structureSlotId: "BASE-01",
      chapterFunction: "Force Mara into a charter choice.",
      povCharacterId: "char-mara",
      protagonistPressure: "Mara must choose whether to expose Ashren.",
      centralConflict: "Charter law conflicts with family loyalty.",
      irreversibleChange: "Mara signs the charter.",
      endpointOrHook: "The charter names her as liable.",
      requiredCharacterWork: "Mara and Ashren change leverage.",
      requiredWorldWork: "Charter law imposes cost.",
      requiredStoryDebtWork: "The succession promise narrows.",
      scenes: [
        {
          sceneId: "sc-01-01",
          chapterId: "ch-01",
          structureSlotId: "BASE-01",
          sceneFunction: "Mara confronts Ashren.",
          povCharacterId: "char-mara",
          locationOrArena: "charter hall",
          goal: "Mara wants Ashren to confess.",
          conflict: "Ashren uses charter law against her.",
          turnOrValueShift: "Mara gains proof but becomes liable.",
          outcome: "Mara signs.",
          consequence: "The court can punish her.",
          requiredObligationIds: ["obl-01"],
          requiredSourceIds: ["src-char-mara", "src-world-charter"],
          requiredCharacterIds: ["char-mara", "char-ashren"],
          requiredWorldFactIds: ["world-charter"],
        },
        {
          sceneId: "sc-01-02",
          chapterId: "ch-01",
          structureSlotId: "BASE-01",
          sceneFunction: "Mara hides the signed charter.",
          povCharacterId: "char-mara",
          locationOrArena: "archive",
          goal: "Mara wants a safe copy.",
          conflict: "The archive records every touch.",
          turnOrValueShift: "She saves proof but reveals her route.",
          outcome: "The copy survives.",
          consequence: "Her escape path is exposed.",
          requiredObligationIds: [],
          requiredSourceIds: [],
          requiredCharacterIds: ["char-mara"],
          requiredWorldFactIds: [],
        },
      ],
      obligations: [{
        obligationId: "obl-01",
        sourceId: "src-world-charter",
        sourceKind: "world",
        coveragePolicy: "must_satisfy",
        requirementText: "Charter law must impose a concrete cost.",
        linkedCharacterIds: ["char-mara"],
        linkedWorldFactIds: ["world-charter"],
      }],
    }],
  }
}

function aggregate() {
  return {
    groups: [
      group("fixture-a", "test:method", "old-1"),
      group("fixture-a", "control", "old-2"),
      group("fixture-b", "test:method", "old-3"),
    ],
  }
}

function group(fixtureId: string, armId: string, groupId: string) {
  return {
    groupId,
    fixtureId,
    armId,
    findings: [{ findingId: `${groupId}.1`, label: "REL-1" }],
  }
}
