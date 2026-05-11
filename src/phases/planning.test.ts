import { describe, expect, test } from "bun:test"

import {
  applySelectiveSceneTurnShapingFallback,
  planningBeatExpansionRetryReason,
} from "./planning"
import type { SceneBeat, SeedInput } from "../types"

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
})

function scene(description: string, overrides: Partial<SceneBeat> = {}): SceneBeat {
  return {
    description,
    characters: ["Maren"],
    kind: "action",
    requiredPayoffs: [],
    obligations: {
      mustEstablish: [],
      mustPayOff: [],
      mustTransferKnowledge: [],
      mustShowStateChange: [],
      mustNotReveal: [],
      allowedNewEntities: [],
    },
    lifeValueAxes: [],
    miceActive: [],
    miceOpens: [],
    miceCloses: [],
    ...overrides,
  }
}

function seed(pipelineOverrides: SeedInput["pipelineOverrides"]): Pick<SeedInput, "pipelineOverrides"> {
  return { pipelineOverrides }
}
