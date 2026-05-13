import { describe, expect, test } from "bun:test"

import {
  auditPlanningMaterialPressureGaps,
  auditSelectiveSceneTurnShapingGaps,
  planningScenesSystemPromptForSeed,
  planningSceneExpansionRetryReason,
  planningSkeletonRetryReason,
  planningStateMapperSystemPromptForSeed,
} from "./planning"
import type { ChapterOutline, SceneBeat, SeedInput } from "../types"

describe("planningSceneExpansionRetryReason", () => {
  test("keeps planning prompt byte-identical when selective shaping is off", () => {
    const prompt = planningScenesSystemPromptForSeed(seed({}))

    expect(prompt).not.toContain("Active Output Contract Addendum")
    expect(prompt).not.toContain("planningSceneTurnShapingV1")
  })

  test("adds selective scene-turn fields to the system output contract only when flagged", () => {
    const prompt = planningScenesSystemPromptForSeed(seed({ planningSceneTurnShapingV1: true }))

    expect(prompt).toContain("Active Output Contract Addendum: planningSceneTurnShapingV1")
    expect(prompt).toContain("`goal`")
    expect(prompt).toContain("`outcome`")
    expect(prompt).toContain("`consequence`")
    expect(prompt).toContain("still do not emit chapter-level state, obligations, or requiredPayoffs")
    expect(prompt).toContain("Scope discipline: do not add entries")
    expect(prompt).toContain("Source hygiene: do not invent a new offstage crime")
    expect(prompt).toContain("Character hygiene: `characters[]` must contain actual named cast members")
  })

  test("adds materialityTest to the state-mapper system output contract only when flagged", () => {
    const offPrompt = planningStateMapperSystemPromptForSeed(seed({}))
    const onPrompt = planningStateMapperSystemPromptForSeed(seed({ planningMaterialPressureV1: true }))

    expect(offPrompt).not.toContain("Active Output Contract Addendum: Materiality Pressure")
    expect(onPrompt).toContain("`materialityTest`")
    expect(onPrompt).toContain("planningMaterialPressureV1")
  })

  test("retries selective scene-turn shaping when final endpoint fields are absent", () => {
    expect(planningSceneExpansionRetryReason({
      chapterNumber: 1,
      targetWords: 3100,
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
    expect(planningSceneExpansionRetryReason({
      chapterNumber: 1,
      targetWords: 3100,
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

  test("retries selective scene-turn shaping when source-refed non-final entries lack turn fields", () => {
    expect(planningSceneExpansionRetryReason({
      chapterNumber: 1,
      targetWords: 900,
      scenes: [
        scene("Maren forces the clerk to honor the seal.", {
          obligations: {
            ...emptyObligations(),
            mustEstablish: [{
              text: "Halric's seal compels archive staff.",
              sourceId: "fact-halric-seal-authority",
              sourceKind: "fact",
              obligationId: "obl-seal-authority",
            }],
          },
        }),
        scene("The clerk leads Maren down the archive stair."),
        scene("Maren enters Halric's chamber.", {
          outcome: "Maren enters Halric's chamber.",
          consequence: "Halric must answer before the council seal.",
        }),
      ],
    }, {
      planningSceneTurnShapingV1: true,
    })).toContain("source-refed non-final entries missing goal/opposition/outcome/consequence")
  })

  test("retries selective scene-turn shaping when semantic fields inflate entry count above the recommended budget", () => {
    expect(planningSceneExpansionRetryReason({
      chapterNumber: 1,
      targetWords: 1500,
      scenes: [
        scene("Maren enters the Counting-House.", {
          goal: "Reach her desk before the writ arrives.",
          opposition: "The hall is already waiting for default news.",
          outcome: "Maren reaches the ledger.",
          consequence: "She sees the ruin column before anyone can soften it.",
        }),
        scene("A clerk brings the ledger forward.", {
          goal: "Make the clerk acknowledge the debt column.",
          opposition: "The clerk wants the numbers treated as routine.",
          outcome: "The clerk admits the total moved overnight.",
          consequence: "Maren knows the pressure is active now.",
        }),
        scene("Tovin blocks a creditor's witness.", {
          goal: "Keep the witness from forcing a public confession.",
          opposition: "Tovin can make obstruction look like treason.",
          outcome: "Tovin moves the witness aside.",
          consequence: "Maren owes him an explanation.",
        }),
        scene("Halric's seal appears on the debt slip.", {
          goal: "Trace who authorized the transfer.",
          opposition: "The seal makes the answer politically dangerous.",
          outcome: "Maren confirms Halric's authority.",
          consequence: "She must answer a summons instead of burying the slip.",
        }),
        scene("Maren leaves with Halric's summons.", {
          goal: "Leave without accepting the transfer.",
          opposition: "The summons makes delay impossible.",
          outcome: "Maren takes the summons.",
          consequence: "Halric expects her before dawn.",
        }),
        scene("Maren crosses the bridge toward the Treasury.", {
          goal: "Reach the Treasury before the clerks lock the ledgers.",
          opposition: "The bridge guard can delay her until dawn.",
          outcome: "Maren crosses.",
          consequence: "The city sees her carrying Halric's seal.",
        }),
      ],
    }, {
      planningSceneTurnShapingV1: true,
    })).toBe("planningSceneTurnShapingV1 6 entries > semantic scope budget 3 for 1500w target")
  })

  test("accepts selective scene-turn shaping when source-refed non-final entries have turn fields", () => {
    expect(planningSceneExpansionRetryReason({
      chapterNumber: 1,
      targetWords: 900,
      scenes: [
        scene("Maren forces the clerk to honor the seal.", {
          goal: "Force the clerk to open the sealed archive.",
          opposition: "The clerk can refuse unless the seal creates immediate risk.",
          outcome: "The clerk opens the archive ledger.",
          consequence: "Maren reaches the forged page before Halric can bury it.",
          obligations: {
            ...emptyObligations(),
            mustEstablish: [{
              text: "Halric's seal compels archive staff.",
              sourceId: "fact-halric-seal-authority",
              sourceKind: "fact",
              obligationId: "obl-seal-authority",
            }],
          },
        }),
        scene("The clerk leads Maren down the archive stair."),
        scene("Maren enters Halric's chamber.", {
          outcome: "Maren enters Halric's chamber.",
          consequence: "Halric must answer before the council seal.",
        }),
      ],
    }, {
      planningSceneTurnShapingV1: true,
    })).toBeNull()
  })

  test("retries selective scene-turn shaping when characters contain unnamed role labels", () => {
    expect(planningSceneExpansionRetryReason({
      chapterNumber: 1,
      targetWords: 900,
      scenes: [
        scene("Maren transfers a small debt while a debtor accepts the burden.", {
          characters: ["Maren", "Minor Debtor (unnamed woman)"],
          goal: "Move a small debt without worsening the default.",
          opposition: "The transfer will still accrue phantom interest.",
          outcome: "The debtor accepts the transfer.",
          consequence: "Maren's own ledger worsens.",
        }),
        scene("Maren returns to the Counting-House.", {
          goal: "Hide the new phantom interest.",
          opposition: "The ledger total has moved beyond her expected margin.",
          outcome: "Maren conceals the private ledger.",
          consequence: "She enters Halric's summons with less room to maneuver.",
        }),
        scene("Maren leaves with Halric's summons.", {
          outcome: "Maren leaves with Halric's summons.",
          consequence: "Halric expects her answer before dawn.",
        }),
      ],
    }, {
      planningSceneTurnShapingV1: true,
    })).toContain("checker-visible character labels are unnamed or parenthetical roles")
  })

  test("does not apply selective scene-turn retry under full scene-plan contract", () => {
    expect(planningSceneExpansionRetryReason({
      chapterNumber: 1,
      targetWords: 900,
      scenes: [scene("Maren leaves with Halric's summons.")],
    }, {
      nativePlanningContractV1: true,
      planningSceneTurnShapingV1: true,
      scenePlanContractV1: true,
    })).toBeNull()
  })

  test("retries short fixed-arc skeleton scope when selective semantic planning oversizes target words", () => {
    expect(planningSkeletonRetryReason([
      { chapterNumber: 1, targetWords: 2000 },
      { chapterNumber: 2, targetWords: 1800 },
    ], {
      targetChapters: 2,
      planningSceneTurnShapingV1: true,
    })).toContain("ch1=2000w")
  })

  test("does not retry skeleton scope without selective semantic planning or for longer arcs", () => {
    expect(planningSkeletonRetryReason([
      { chapterNumber: 1, targetWords: 2000 },
      { chapterNumber: 2, targetWords: 2000 },
    ], {
      targetChapters: 2,
    })).toBeNull()

    expect(planningSkeletonRetryReason([
      { chapterNumber: 1, targetWords: 2000 },
      { chapterNumber: 2, targetWords: 2000 },
      { chapterNumber: 3, targetWords: 2000 },
    ], {
      targetChapters: 3,
      planningMaterialPressureV1: true,
    })).toBeNull()
  })

  test("reports final endpoint gaps without fallback-filling from existing plan text", () => {
    const sourceScenes = [
      scene("Maren enters the Counting-House."),
      scene("Maren pockets Halric's sealed summons."),
    ]
    const audit = auditSelectiveSceneTurnShapingGaps(
      "unit-novel",
      {
        chapterNumber: 1,
        purpose: "Maren receives Halric's summons. The chapter ends with Tovin escorting her toward the Chancellor's locked chamber.",
      },
      sourceScenes,
      seed({ planningSceneTurnShapingV1: true }),
    )

    expect(audit).toMatchObject({
      active: true,
      finalMissingFields: ["outcome", "consequence"],
      sourceRefedNonFinalEntriesMissing: 0,
    })
    expect(sourceScenes.at(-1)?.outcome).toBeUndefined()
    expect(sourceScenes.at(-1)?.consequence).toBeUndefined()
  })

  test("reports source-refed non-final turn gaps without synthesizing writer-facing fields", () => {
    const sourceScenes = [
      scene("Maren uses the summons to force a clerk's help.", {
        characters: ["Maren", "Clerk"],
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
      scene("Maren enters Halric's locked chamber."),
    ]
    const audit = auditSelectiveSceneTurnShapingGaps(
      "unit-novel",
      { chapterNumber: 1, purpose: "Maren reaches Halric's locked chamber." },
      sourceScenes,
      seed({ planningSceneTurnShapingV1: true }),
    )

    expect(audit).toMatchObject({
      active: true,
      finalMissingFields: ["outcome", "consequence"],
      sourceRefedNonFinalEntriesMissing: 1,
      sourceRefedNonFinalFieldsMissing: 4,
    })
    expect(sourceScenes[0]?.goal).toBeUndefined()
    expect(sourceScenes[0]?.opposition).toBeUndefined()
    expect(sourceScenes[0]?.outcome).toBeUndefined()
    expect(sourceScenes[0]?.consequence).toBeUndefined()
  })

  test("does not audit selective shaping when the control is off", () => {
    const sourceScenes = [scene("Maren pockets Halric's sealed summons.")]
    const audit = auditSelectiveSceneTurnShapingGaps(
      "unit-novel",
      { chapterNumber: 1, purpose: "Maren receives Halric's summons." },
      sourceScenes,
      seed({}),
    )

    expect(audit).toEqual({
      active: false,
      finalMissingFields: [],
      sourceRefedNonFinalEntriesMissing: 0,
      sourceRefedNonFinalFieldsMissing: 0,
    })
    expect(sourceScenes.at(-1)?.outcome).toBeUndefined()
    expect(sourceScenes.at(-1)?.consequence).toBeUndefined()
  })

  test("reports material pressure gaps on source-refed non-final obligations without fallback-filling", () => {
    const source = chapter({
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
    })
    const audit = auditPlanningMaterialPressureGaps(
      "unit-novel",
      source,
      seed({ planningMaterialPressureV1: true }),
    )

    expect(audit).toEqual({
      active: true,
      sourceRefedNonFinalObligationsMissing: 2,
      sourceRefedNonFinalScenesMissing: 1,
    })
    expect(source.scenes[0]?.obligations.mustEstablish[0]?.materialityTest).toBeUndefined()
    expect(source.scenes[0]?.obligations.mustTransferKnowledge[0]?.materialityTest).toBeUndefined()
    expect(source.scenes[1]?.obligations.mustEstablish[0]?.materialityTest).toBeUndefined()
  })

  test("does not audit material pressure when the control is off or full scene-plan contract is on", () => {
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
      auditPlanningMaterialPressureGaps("unit-novel", source, seed({})),
    ).toMatchObject({ active: false, sourceRefedNonFinalObligationsMissing: 0 })
    expect(
      auditPlanningMaterialPressureGaps("unit-novel", source, seed({
        planningMaterialPressureV1: true,
        scenePlanContractV1: true,
      })),
    ).toMatchObject({ active: false, sourceRefedNonFinalObligationsMissing: 0 })
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
