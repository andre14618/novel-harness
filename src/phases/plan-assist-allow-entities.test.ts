import { describe, expect, test } from "bun:test"

import type { ChapterOutline } from "../types"
import type { PlanAssistGatePayload } from "../gates"
import {
  applyAllowedEntityPatchesToOutline,
  buildAllowedEntityPatchesFromPlanAssistPayload,
} from "./plan-assist-allow-entities"

describe("plan-assist allow entities", () => {
  test("extracts halluc-ungrounded entities from plan-assist deviations by beat", () => {
    const patches = buildAllowedEntityPatchesFromPlanAssistPayload({
      ...payload(),
      unresolvedDeviations: [
        {
          beat_index: 0,
          description: "[beat-check:halluc-ungrounded] Beat 1: fallback",
          metadata: {
            hallucUngrounded: { entity: "Tomas Vogler", excerpt: "", entityRefs: [] },
          },
        },
        {
          beat_index: 0,
          description: "[beat-check:halluc-ungrounded] Beat 1: Ungrounded entity \"Harvest\" — context: x",
        },
        {
          beat_index: null,
          description: "[functional] not beat scoped",
        },
      ],
    })

    expect(patches).toEqual([{
      beatIndex: 0,
      entities: ["Harvest", "Tomas Vogler"],
    }])
  })

  test("appends reviewed entities to the affected scene only", () => {
    const result = applyAllowedEntityPatchesToOutline(outline(), [{
      beatIndex: 0,
      entities: [" Tomas Vogler ", "Harvest", "harvest"],
    }])

    expect(result.applied).toEqual([{
      beatIndex: 0,
      sceneId: "scene-1",
      beatId: "beat-1",
      addedEntities: ["Tomas Vogler", "Harvest"],
      alreadyAllowedEntities: [],
      missingEntities: [],
    }])
    expect(result.outline.scenes[0]!.obligations.allowedNewEntities).toEqual([
      "Tomas Vogler",
      "Harvest",
    ])
    expect(result.outline.scenes[1]!.obligations.allowedNewEntities).toEqual([])
  })

  test("reports duplicates and invalid beat indexes without corrupting the outline", () => {
    const result = applyAllowedEntityPatchesToOutline(outline({
      scenes: [
        scene("scene-1", "beat-1", ["Tomas Vogler"]),
      ],
    }), [
      { beatIndex: 0, entities: ["tomas vogler", "Harvest"] },
      { beatIndex: 9, entities: ["Missing Beat Entity"] },
    ])

    expect(result.applied[0]).toMatchObject({
      beatIndex: 0,
      addedEntities: ["Harvest"],
      alreadyAllowedEntities: ["Tomas Vogler"],
      missingEntities: [],
    })
    expect(result.applied[1]).toMatchObject({
      beatIndex: 9,
      addedEntities: [],
      alreadyAllowedEntities: [],
      missingEntities: ["Missing Beat Entity"],
    })
    expect(result.outline.scenes[0]!.obligations.allowedNewEntities).toEqual([
      "Tomas Vogler",
      "Harvest",
    ])
  })
})

function payload(): PlanAssistGatePayload {
  return {
    kind: "plan-check-exhausted",
    novelId: "novel-1",
    chapter: 1,
    attempt: 1,
    outline: outline(),
    prose: "draft",
    unresolvedDeviations: [],
  }
}

function outline(overrides: Partial<ChapterOutline> = {}): ChapterOutline {
  return {
    chapterId: "ch-1",
    chapterNumber: 1,
    title: "The Ledger",
    povCharacter: "Maren",
    setting: "Counting-House",
    purpose: "Test",
    targetWords: 1500,
    scenes: [
      scene("scene-1", "beat-1"),
      scene("scene-2", "beat-2"),
    ],
    charactersPresent: ["Maren"],
    establishedFacts: [],
    characterStateChanges: [],
    knowledgeChanges: [],
    ...overrides,
  } as ChapterOutline
}

function scene(sceneId: string, beatId: string, allowedNewEntities: string[] = []): any {
  return {
    sceneId,
    beatId,
    description: "Maren studies the ledger.",
    kind: "action",
    characters: ["Maren"],
    obligations: {
      mustEstablish: [],
      mustPayOff: [],
      mustTransferKnowledge: [],
      mustShowStateChange: [],
      mustNotReveal: [],
      allowedNewEntities,
    },
  }
}
