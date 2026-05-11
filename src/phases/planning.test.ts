import { describe, expect, test } from "bun:test"

import {
  applyPlanningMaterialPressureFallback,
  applySelectiveSceneTurnShapingFallback,
  planningBeatExpansionRetryReason,
} from "./planning"
import type { ChapterOutline, SceneBeat, SeedInput } from "../types"

describe("planningBeatExpansionRetryReason", () => {
  test("retries selective scene-turn shaping when final endpoint fields are absent", () => {
    expect(planningBeatExpansionRetryReason({
      chapterNumber: 1,
      targetWords: 900,
      scenes: [
        scene("Maren enters the Counting-House."),
        scene("A clerk brings the ledger forward."),
        scene("Tovin blocks a creditor's witness."),
        scene("Halric's seal appears on the debt slip."),
        scene("Maren leaves with Halric's summons."),
      ],
    }, {
      nativePlanningContractV1: false,
      planningSceneTurnShapingV1: true,
    })).toBe("planningSceneTurnShapingV1 final entry missing outcome/consequence endpoint fields")
  })

  test("accepts selective scene-turn shaping when final endpoint fields are present", () => {
    expect(planningBeatExpansionRetryReason({
      chapterNumber: 1,
      targetWords: 900,
      scenes: [
        scene("Maren enters the Counting-House."),
        scene("A clerk brings the ledger forward."),
        scene("Tovin blocks a creditor's witness."),
        scene("Halric's seal appears on the debt slip."),
        scene("Maren leaves with Halric's summons.", {
          outcome: "Maren pockets Halric's sealed summons.",
          consequence: "Tovin must escort her into the Chancellor's chambers before dawn.",
        }),
      ],
    }, {
      nativePlanningContractV1: false,
      planningSceneTurnShapingV1: true,
    })).toBeNull()
  })

  test("does not apply selective scene-turn retry under full scene-plan contract", () => {
    expect(planningBeatExpansionRetryReason({
      chapterNumber: 1,
      targetWords: 900,
      scenes: [scene("Maren leaves with Halric's summons.")],
    }, {
      nativePlanningContractV1: true,
      planningSceneTurnShapingV1: true,
      scenePlanContractV1: true,
    })).toBeNull()
  })

  test("fills final endpoint fields from existing plan text under selective shaping", () => {
    const scenes = applySelectiveSceneTurnShapingFallback(
      "unit-novel",
      {
        chapterNumber: 1,
        purpose: "Maren receives Halric's summons. The chapter ends with Tovin escorting her toward the Chancellor's locked chamber.",
      },
      [
        scene("Maren enters the Counting-House."),
        scene("Maren pockets Halric's sealed summons."),
      ],
      seed({ planningSceneTurnShapingV1: true }),
    )

    expect(scenes.at(-1)?.outcome).toBe("Maren pockets Halric's sealed summons.")
    expect(scenes.at(-1)?.consequence).toBe("Chapter endpoint consequence: Tovin escorting her toward the Chancellor's locked chamber")
  })

  test("does not fill final endpoint fields when selective shaping is off", () => {
    const scenes = applySelectiveSceneTurnShapingFallback(
      "unit-novel",
      { chapterNumber: 1, purpose: "Maren receives Halric's summons." },
      [scene("Maren pockets Halric's sealed summons.")],
      seed({}),
    )

    expect(scenes.at(-1)?.outcome).toBeUndefined()
    expect(scenes.at(-1)?.consequence).toBeUndefined()
  })

  test("fills material pressure on existing source-refed non-final obligations", () => {
    const outline = applyPlanningMaterialPressureFallback(
      "unit-novel",
      chapter({
        scenes: [
          scene("Maren uses the summons to force a clerk's help.", {
            opposition: "The clerk can refuse unless Halric's seal carries immediate risk.",
            obligations: {
              ...emptyObligations(),
              mustEstablish: [{
                text: "Halric's seal can compel archive staff.",
                sourceId: "fact-halric-seal-authority",
                sourceKind: "fact",
                obligationId: "obl-seal-authority",
              }],
              mustTransferKnowledge: [{
                text: "Maren learns the clerk fears Halric.",
                sourceId: "know-maren-clerk-fears-halric",
                sourceKind: "knowledge",
                obligationId: "obl-maren-clerk-fear",
                characterName: "Maren",
                characterId: "char-maren",
              }],
            },
          }),
          scene("Maren enters Halric's locked chamber.", {
            obligations: {
              ...emptyObligations(),
              mustEstablish: [{
                text: "The chamber is locked by Halric's seal.",
                sourceId: "fact-halric-locked-chamber",
                sourceKind: "fact",
                obligationId: "obl-final-lock",
              }],
            },
          }),
        ],
      }),
      seed({ planningMaterialPressureV1: true }),
    )

    expect(outline.scenes[0]?.obligations.mustEstablish[0]?.materialityTest).toContain(
      "make this world fact constrain the scene choice",
    )
    expect(outline.scenes[0]?.obligations.mustEstablish[0]?.materialityTest).toContain(
      "The clerk can refuse",
    )
    expect(outline.scenes[0]?.obligations.mustTransferKnowledge[0]?.materialityTest).toContain(
      "Maren: make this knowledge alter action",
    )
    expect(outline.scenes[1]?.obligations.mustEstablish[0]?.materialityTest).toBeUndefined()
  })

  test("does not fill material pressure when the control is off or full scene-plan contract is on", () => {
    const source = chapter({
      scenes: [
        scene("Maren uses the summons.", {
          obligations: {
            ...emptyObligations(),
            mustEstablish: [{
              text: "Halric's seal can compel archive staff.",
              sourceId: "fact-halric-seal-authority",
              sourceKind: "fact",
              obligationId: "obl-seal-authority",
            }],
          },
        }),
        scene("Maren exits."),
      ],
    })

    expect(
      applyPlanningMaterialPressureFallback("unit-novel", source, seed({}))
        .scenes[0]?.obligations.mustEstablish[0]?.materialityTest,
    ).toBeUndefined()
    expect(
      applyPlanningMaterialPressureFallback("unit-novel", source, seed({
        planningMaterialPressureV1: true,
        scenePlanContractV1: true,
      })).scenes[0]?.obligations.mustEstablish[0]?.materialityTest,
    ).toBeUndefined()
  })
})

function scene(description: string, overrides: Partial<SceneBeat> = {}): SceneBeat {
  return {
    description,
    characters: ["Maren"],
    kind: "action",
    requiredPayoffs: [],
    obligations: emptyObligations(),
    lifeValueAxes: [],
    miceActive: [],
    miceOpens: [],
    miceCloses: [],
    ...overrides,
  }
}

function chapter(overrides: Partial<ChapterOutline> = {}): ChapterOutline {
  return {
    chapterNumber: 1,
    title: "The Ledger",
    povCharacter: "Maren",
    setting: "Counting-House",
    purpose: "Maren reaches Halric's chamber.",
    targetWords: 900,
    charactersPresent: ["Maren"],
    charactersPresentIds: [],
    scenes: [],
    establishedFacts: [],
    characterStateChanges: [],
    knowledgeChanges: [],
    ...overrides,
  }
}

function emptyObligations(): SceneBeat["obligations"] {
  return {
    mustEstablish: [],
    mustPayOff: [],
    mustTransferKnowledge: [],
    mustShowStateChange: [],
    mustNotReveal: [],
    allowedNewEntities: [],
  }
}

function seed(pipelineOverrides: SeedInput["pipelineOverrides"]): Pick<SeedInput, "pipelineOverrides"> {
  return { pipelineOverrides }
}
