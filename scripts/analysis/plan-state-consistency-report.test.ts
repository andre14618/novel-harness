import { describe, expect, test } from "bun:test"
import { buildPlanReadinessDraftsFromAggregate } from "../../src/harness/plan-readiness"
import type { ChapterOutline } from "../../src/types"
import {
  buildPlanStateConsistencyPairPackets,
  buildPlanStateConsistencyReport,
} from "./plan-state-consistency-report"

describe("plan-state-consistency-report", () => {
  test("preserves intended-vs-completed fact status in chapter pair packets", () => {
    const packets = buildPlanStateConsistencyPairPackets(outlines())

    expect(packets).toHaveLength(1)
    expect(packets[0]?.priorChapter.establishedFacts[0]).toMatchObject({
      id: "fact-escape-separately",
      factStatus: "intended",
    })
    expect(packets[0]?.nextChapter.establishedFacts).toEqual([])
    expect(packets[0]?.nextChapter.characterStateChanges).toEqual([])
    expect(packets[0]?.nextChapter.knowledgeChanges).toEqual([])
    expect(packets[0]?.targetOptions.map(target => target.key)).toEqual(expect.arrayContaining([
      "scene_plan:scene-ch8-5:consequence",
      "scene_plan:scene-ch8-5:opposition",
    ]))
  })

  test("turns semantic handoff findings into deterministic readiness targets", async () => {
    const { report, aggregate } = await buildPlanStateConsistencyReport({
      novelId: "novel",
      outlines: outlines(),
      live: true,
      generatedAt: "2026-05-14T00:00:00.000Z",
      judgePair: packet => ({
        findings: [{
          verdict: "status_ambiguity",
          severity: "high",
          label: "PLANNED-VS-EXECUTED-AMBIGUITY",
          repairTargetKey: packet.targetOptions.find(target => target.key === "scene_plan:scene-ch8-5:consequence")?.key ?? "",
          rationale: "Chapter 8 treats the split as accomplished while Chapter 9 needs both characters together.",
          evidence: "split routes vs reach the exit together",
          missingForNextLevel: "Make the split an intended plan that is interrupted before execution.",
        }],
      }),
    })

    expect(report.findingCount).toBe(1)
    expect(aggregate.groupCount).toBe(1)
    expect(aggregate.groups[0]?.rewritePacket.proposalCandidate.target).toEqual({
      kind: "scene_plan",
      ref: "scene-ch8-5",
      fieldPath: "consequence",
    })

    const readiness = buildPlanReadinessDraftsFromAggregate({
      novelId: "novel",
      aggregate,
      targetVersions: {
        "scene_plan:scene-ch8-5": "c".repeat(64),
      },
    })

    expect(readiness.skipped).toHaveLength(0)
    expect(readiness.drafts).toHaveLength(1)
    expect(readiness.drafts[0]?.target).toEqual({
      kind: "scene_plan",
      ref: "scene-ch8-5",
      fieldPath: "consequence",
    })
    expect(readiness.drafts[0]?.fixIntent).toBe("clarify_planned_vs_completed_state")
  })
})

function outlines(): ChapterOutline[] {
  return [
    {
      chapterNumber: 8,
      chapterId: "ch-008-ledger-flight",
      title: "Ledger Flight",
      povCharacter: "Kael",
      setting: "Gray Salt Mine",
      purpose: "Kael and Tessa preserve the ledger and prepare separate routes back to Rillgate.",
      targetWords: 3100,
      charactersPresent: ["Kael", "Tessa"],
      charactersPresentIds: [],
      scenes: [{
        sceneId: "scene-ch8-5",
        description: "Kael and Tessa decide to leave the mine separately to avoid attention.",
        characters: ["Kael", "Tessa"],
        kind: "dialogue",
        requiredPayoffs: [],
        obligations: emptyObligations(),
        outcome: "They prepare to depart at dawn by different routes.",
        consequence: "Kael is framed as leaving alone with the evidence.",
      }],
      establishedFacts: [{
        id: "fact-escape-separately",
        fact: "Kael and Tessa intend to leave the mine separately to avoid drawing attention.",
        category: "temporal",
        factStatus: "intended",
      }],
      characterStateChanges: [],
      knowledgeChanges: [],
    },
    {
      chapterNumber: 9,
      chapterId: "ch-009-witness-choice",
      title: "Witness Choice",
      povCharacter: "Kael",
      setting: "Gray Salt Mine exit",
      purpose: "Kael chooses Tessa's testimony over a clean core payout.",
      targetWords: 3100,
      charactersPresent: ["Kael", "Tessa"],
      charactersPresentIds: [],
      scenes: [{
        sceneId: "scene-ch9-1",
        description: "Kael and Tessa reach the sealed chamber exit together.",
        characters: ["Kael", "Tessa"],
        kind: "action",
        requiredPayoffs: [],
        obligations: emptyObligations(),
        outcome: "The buyer demands Tessa be left behind.",
        consequence: "Kael must choose witness testimony or clean payment.",
      }],
      establishedFacts: [{
        id: "fact-tessa-wounded",
        fact: "Tessa is wounded during the exit fight.",
        category: "physical",
      }],
      characterStateChanges: [{
        id: "state-kael-later",
        characterId: "char-kael",
        name: "Kael",
        location: "later in chapter nine",
        emotionalState: "under pressure",
        knows: ["Tessa can testify"],
        doesNotKnow: [],
      }],
      knowledgeChanges: [{
        id: "know-kael-later",
        characterId: "char-kael",
        characterName: "Kael",
        knowledge: "Tessa can testify after the confrontation.",
        source: "later chapter outcome",
      }],
    },
  ] as ChapterOutline[]
}

function emptyObligations() {
  return {
    mustEstablish: [],
    mustPayOff: [],
    mustTransferKnowledge: [],
    mustShowStateChange: [],
    mustNotReveal: [],
    allowedNewEntities: [],
  }
}
