import { describe, expect, test } from "bun:test"

import {
  buildDiagnosticReport,
  normalizePlannerContractPlan,
  scorePlan,
  type PlannerContractPlan,
  type PlannerDiagnosticFixture,
} from "./method-pack-planner-diagnostic"

describe("method-pack-planner-diagnostic", () => {
  test("scores method-pack contract shape without rewarding beat count", () => {
    const control = weakPlan("control:no-method", null, null)
    const method = strongPlan("test:commercial-fantasy-adventure-v0")

    const report = buildDiagnosticReport(fixture, [
      { armId: control.armId, label: "control", methodPackEnabled: false, plan: control },
      { armId: method.armId, label: "method", methodPackEnabled: true, plan: method },
    ], { mode: "fixture", fixturePath: "inline", generatedAt: "2026-05-07T00:00:00.000Z" })

    expect(report.arms[0]!.score.dimensions.templateSlotFit.possible).toBe(0)
    expect(report.arms[1]!.score.dimensions.templateSlotFit.ratio).toBe(1)
    expect(report.arms[1]!.score.totalRatio).toBeGreaterThan(report.arms[0]!.score.totalRatio)
    expect(report.comparison.verdict).toBe("DIRECTIONAL-PASS")
  })

  test("flags missing refs and scene overfragmentation as hold issues", () => {
    const plan = strongPlan("test:commercial-fantasy-adventure-v0")
    plan.chapters[0]!.scenes = [
      ...plan.chapters[0]!.scenes,
      scene("scene-extra-1", "ch-cfa-01", "CFA-01"),
      scene("scene-extra-2", "ch-cfa-01", "CFA-01"),
      scene("scene-extra-3", "ch-cfa-01", "CFA-01"),
      scene("scene-extra-4", "ch-cfa-01", "CFA-01"),
    ]
    plan.chapters[0]!.scenes[0]!.requiredObligationIds = ["missing-obligation"]

    const score = scorePlan(plan, fixture, true)

    expect(score.dimensions.overfragmentation.issues.join("\n")).toContain("has 5 scenes")
    expect(score.dimensions.idCompleteness.issues.join("\n")).toContain("missing-obligation")
  })

  test("scores v1 framework fields without applying them to v0 fixtures", () => {
    const method = strongV1Plan("test:commercial-fantasy-adventure-v1")
    const score = scorePlan(method, fixtureV1, true)

    expect(score.dimensions.strategyConservation.ratio).toBeGreaterThanOrEqual(0.8)
    expect(score.dimensions.storyGridSceneContract.ratio).toBe(1)
    expect(score.dimensions.characterArcPressure.ratio).toBe(1)
    expect(score.dimensions.storyDebtTraceability.ratio).toBe(1)

    const v0Score = scorePlan(strongPlan("test:commercial-fantasy-adventure-v0"), fixture, true)
    expect(v0Score.dimensions.storyGridSceneContract.possible).toBe(0)
  })

  test("normalizes common live-output aliases before scoring", () => {
    const normalized = normalizePlannerContractPlan({
      plan: {
        chapters: [{
          chapterNumber: 1,
          title: "The Burned Map",
          structureSlotId: "CFA-01",
          povCharacterId: "char-mara-vey",
          pressure: "Mara must choose whether to hide the burned true-ink map.",
          conflict: "Ashren uses charter law to force obedience.",
          change: "Mara discovers the official map omits a living road.",
          chapterHook: "Mara chooses the truthful route despite Ashren's threat.",
          characterWork: "Mara chooses to trust Sena before Ashren can punish them.",
          worldWork: "The living road and true-ink force the dangerous choice.",
          promiseWork: "The erased province promise advances through the map.",
          must_satisfy: [{ text: "Mara must choose the truthful route.", sourceId: "world-living-roads", linkedWorldFactIds: ["world-living-roads"] }],
          scenes: [{
            sceneNumber: 1,
            goal: "Mara tests the map.",
            conflict: "Ashren's law makes the test illegal.",
            turn: "The true-ink burns where the province is missing.",
            outcome: "Mara chooses the truthful route despite Ashren's threat.",
            consequence: "Ashren can now punish her for drawing it.",
          }],
        }],
      },
    }, fixture, { armId: "test:commercial-fantasy-adventure-v0", methodPackEnabled: true })

    expect(normalized.armId).toBe("test:commercial-fantasy-adventure-v0")
    expect(normalized.chapters[0]!.chapterId).toBe("ch-01-cfa-01")
    expect(normalized.chapters[0]!.endpointOrHook).toContain("truthful route")
    expect(normalized.chapters[0]!.scenes[0]!.turnOrValueShift).toContain("true-ink burns")
    expect(normalized.chapters[0]!.scenes[0]!.opposition).toContain("Ashren")
    expect(normalized.chapters[0]!.scenes[0]!.turningPoint).toContain("true-ink burns")
    expect(normalized.chapters[0]!.obligations[0]!.sourceKind).toBe("world")
  })
})

const fixture: PlannerDiagnosticFixture = {
  diagnosticId: "test-diagnostic",
  methodPackId: "commercial-fantasy-adventure-v0",
  templateId: "commercial-24-flex-v0",
  targetSlots: [
    { structureSlotId: "CFA-01", structureJob: "Pressure baseline", planningTest: "baseline" },
    { structureSlotId: "CFA-22", structureJob: "Defining choice", planningTest: "choice" },
  ],
  concept: {
    genreProfileId: "general-commercial-fantasy-adventure",
    premise: "Mara maps a hidden road.",
    readerPromise: "map adventure",
    centralConflict: "Mara exposes the Crown Survey.",
    protagonist: {
      characterId: "char-mara-vey",
      name: "Mara Vey",
      desire: "restore her charter",
      fear: "being used",
      flaw: "withholds plans",
    },
    characters: [
      { characterId: "char-sena-vale", name: "Sena Vale", role: "supporting", materiality: "forces trust" },
      { characterId: "char-lord-ashren", name: "Lord Ashren", role: "antagonist", materiality: "controls law" },
    ],
    worldFacts: [
      { worldFactId: "world-living-roads", fact: "roads shift around lies" },
      { worldFactId: "world-true-ink", fact: "ink burns omissions" },
    ],
    storyPromise: { promiseId: "promise-erased-province", text: "find the erased province" },
    storyDebts: [],
    constraints: ["contracts only"],
  },
}

const fixtureV1: PlannerDiagnosticFixture = {
  ...fixture,
  diagnosticId: "test-diagnostic-v1",
  methodPackId: "commercial-fantasy-adventure-v1",
  templateId: "commercial-24-flex-v1",
  concept: {
    ...fixture.concept,
    strategyPacket: {
      strategyPacketId: "strategy-mapmaker-v1",
      logline: "A disgraced cartographer maps a hidden road that punishes lies.",
      paragraphSummary: "Mara wants her charter restored but discovers official maps erase a province. The living road punishes false destinations and forces her to rely on Sena. Ashren offers safety if she hides the omission. Mara must publish the true road and sacrifice sanctioned status. She proves truth matters more than obedience.",
      majorReversals: [
        "The official map is safe because it is a legal lie.",
        "Ashren can restore Mara's charter only if she hides the province.",
      ],
      endingDirection: "Mara publishes the true road and sacrifices sanctioned status.",
      readerPromise: "A map adventure where truth, trust, and hidden roads decide survival.",
      protagonistWant: "restore her cartographer charter",
      protagonistNeed: "trust people outside sanctioned law",
      protagonistLie: "measurements are safer than people",
      protagonistTruth: "truthful maps require trusted witnesses",
      antagonistPressure: "Ashren weaponizes charter law to make true maps criminal.",
      worldPressureRule: "living roads punish false destinations and omissions.",
    },
    storyDebts: [
      {
        storyDebtId: "debt-erased-province",
        promiseText: "Mara can reveal whether the erased province still exists.",
        openedBySlotId: "CFA-01",
        expectedProgressSlotIds: ["CFA-04"],
        expectedPayoffSlotId: "CFA-22",
        payoffPolicy: "pay off through a truthful public map.",
      },
    ],
  },
}

function weakPlan(armId: string, methodPackId: string | null, templateId: string | null): PlannerContractPlan {
  return {
    armId,
    methodPackId,
    templateId,
    chapters: [
      {
        chapterId: "ch-base-01",
        structureSlotId: "BASE-01",
        chapterFunction: "Setup",
        povCharacterId: "char-mara-vey",
        protagonistPressure: "Mara begins.",
        centralConflict: "Trouble starts.",
        irreversibleChange: "Something changes.",
        endpointOrHook: "Mara keeps going.",
        requiredCharacterWork: "Mara is present.",
        requiredWorldWork: "The world is present.",
        requiredStoryDebtWork: "Promise exists.",
        obligations: [],
        scenes: [
          {
            sceneId: "scene-base-01",
            chapterId: "ch-base-01",
            structureSlotId: "BASE-01",
            sceneFunction: "start",
            povCharacterId: "char-mara-vey",
            locationOrArena: "road",
            goal: "start",
            conflict: "trouble",
            opposition: "",
            turnOrValueShift: "change",
            turningPoint: "",
            crisisChoice: "",
            climaxAction: "",
            outcome: "Mara keeps going",
            resolution: "",
            valueIn: "",
            valueOut: "",
            consequence: "next",
            requiredObligationIds: [],
            requiredSourceIds: [],
            requiredCharacterIds: ["char-mara-vey"],
            requiredWorldFactIds: [],
          },
        ],
      },
    ],
  }
}

function strongV1Plan(armId: string): PlannerContractPlan {
  const plan = strongPlan(armId)
  plan.methodPackId = "commercial-fantasy-adventure-v1"
  plan.templateId = "commercial-24-flex-v1"
  for (const chapter of plan.chapters) {
    chapter.requiredStoryDebtWork = "Mara advances debt-erased-province by proving the erased province exists through a true public map."
    chapter.protagonistPressure = "Mara wants her charter but needs to trust Sena because measurements are safer than people is failing."
    chapter.requiredCharacterWork = "Mara must choose trust over isolated measurement and turn truthful witnesses into action."
    chapter.obligations[0]!.sourceId = "debt-erased-province"
    chapter.obligations[0]!.sourceKind = "story_debt"
    chapter.obligations[0]!.requirementText = "Mara must reveal whether the erased province exists through a truthful map."
    chapter.scenes[0]!.requiredSourceIds = ["debt-erased-province"]
    chapter.scenes[0]!.goal = "Mara tries to restore her charter without trusting anyone beyond measurements."
    chapter.scenes[0]!.conflict = "Ashren criminalizes true maps while Sena demands trust outside sanctioned law."
    chapter.scenes[0]!.opposition = "Ashren weaponizes charter law and the living road punishes false destinations."
    chapter.scenes[0]!.turnOrValueShift = "The legal map is revealed as a lie that hides the province."
    chapter.scenes[0]!.turningPoint = "The true-ink burns over the erased province and exposes the legal lie."
    chapter.scenes[0]!.crisisChoice = "Keep the restored charter or trust Sena and publish the true road."
    chapter.scenes[0]!.climaxAction = "Mara publishes the true road with Sena as witness despite Ashren's offer."
    chapter.scenes[0]!.outcome = "Mara sacrifices sanctioned status and proves the erased province still exists."
    chapter.scenes[0]!.resolution = "The public map makes hidden villages legally visible and exposes Ashren's lie."
    chapter.scenes[0]!.valueIn = "obedient legal safety"
    chapter.scenes[0]!.valueOut = "truthful public exposure"
    chapter.scenes[0]!.consequence = "Mara loses sanctioned status but gains trusted witnesses and the true road."
  }
  return plan
}

function strongPlan(armId: string): PlannerContractPlan {
  return {
    armId,
    methodPackId: "commercial-fantasy-adventure-v0",
    templateId: "commercial-24-flex-v0",
    chapters: [
      chapter("ch-cfa-01", "CFA-01", "Mara must choose whether hiding her failed map is safer than exposing why the Crown Survey punished her."),
      chapter("ch-cfa-22", "CFA-22", "Mara wins only by choosing to publish the true road and sacrifice the charter Ashren offers her."),
    ],
  }
}

function chapter(chapterId: string, slotId: string, endpoint: string): PlannerContractPlan["chapters"][number] {
  const obligationId = `obl-${chapterId}`
  const sourceId = slotId === "CFA-01" ? "world-living-roads" : "promise-erased-province"
  return {
    chapterId,
    structureSlotId: slotId,
    chapterFunction: `${slotId} forces Mara to make a concrete story choice under pressure.`,
    povCharacterId: "char-mara-vey",
    protagonistPressure: "Mara must choose between safety and telling the truth before Ashren can punish her.",
    centralConflict: "Ashren uses charter law and the living roads to force Mara into obedience.",
    irreversibleChange: "Mara exposes a true-ink omission that breaks her old trust in sanctioned maps.",
    endpointOrHook: endpoint,
    requiredCharacterWork: "Mara chooses to trust Sena's illegal route, forcing a costly conflict with Ashren.",
    requiredWorldWork: "The living roads and true-ink force the choice by punishing false destinations and omissions.",
    requiredStoryDebtWork: "The erased-province promise must progress through a concrete map discovery.",
    obligations: [
      {
        obligationId,
        sourceId,
        sourceKind: slotId === "CFA-01" ? "world" : "story_promise",
        coveragePolicy: "must_satisfy",
        requirementText: "Mara must use true-ink evidence to choose a dangerous truthful route.",
        linkedCharacterIds: ["char-mara-vey", "char-sena-vale"],
        linkedWorldFactIds: ["world-living-roads", "world-true-ink"],
      },
    ],
    scenes: [
      {
        ...scene(`scene-${chapterId}`, chapterId, slotId),
        outcome: endpoint,
        consequence: endpoint,
        requiredObligationIds: [obligationId],
        requiredSourceIds: [sourceId],
      },
    ],
  }
}

function scene(sceneId: string, chapterId: string, slotId: string): PlannerContractPlan["chapters"][number]["scenes"][number] {
  return {
    sceneId,
    chapterId,
    structureSlotId: slotId,
    sceneFunction: "Force Mara into a choice where the world rule changes the cost.",
    povCharacterId: "char-mara-vey",
    locationOrArena: "border road",
    goal: "Mara tries to prove the map was altered without trusting anyone.",
    conflict: "Sena demands trust while Ashren's charter law threatens punishment.",
    opposition: "Sena demands trust while Ashren's charter law threatens punishment.",
    turnOrValueShift: "The true-ink burns, revealing that official safety depends on a lie.",
    turningPoint: "The true-ink burns, revealing that official safety depends on a lie.",
    crisisChoice: "Mara can stay legally safe or trust Sena's illegal route.",
    climaxAction: "Mara chooses the dangerous truthful route.",
    outcome: "Mara chooses the dangerous truthful route.",
    resolution: "The route becomes visible but makes Mara punishable.",
    valueIn: "legal safety",
    valueOut: "truthful danger",
    consequence: "The choice exposes her to Ashren but advances the erased-province promise.",
    requiredObligationIds: [],
    requiredSourceIds: [],
    requiredCharacterIds: ["char-mara-vey", "char-sena-vale"],
    requiredWorldFactIds: ["world-living-roads", "world-true-ink"],
  }
}
