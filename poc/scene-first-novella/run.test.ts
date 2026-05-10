import { expect, test } from "bun:test"
import {
  applyPlanningNotePreset,
  compactOutlineObligationsForChapterBudget,
  compactOutlineSceneContractsForEndpointControl,
  parseArgs,
} from "./run"

test("defaults POC writer expansion to retry-short-scenes-v1", () => {
  const args = parseArgs(["--run-id", "poc-test"])

  expect(args.writerExpansionMode).toBe("retry-short-scenes-v1")
})

test("allows expansion-off POC runs for writer expansion isolation", () => {
  const args = parseArgs([
    "--fixture",
    "docs/fixtures/scene-first/concepts/pre-resolved/P3-debt-binder-density-cap.json",
    "--chapters",
    "3",
    "--run-id",
    "poc-test",
    "--writer-expansion-mode",
    "off",
  ])

  expect(args.fixturePath).toBe("docs/fixtures/scene-first/concepts/pre-resolved/P3-debt-binder-density-cap.json")
  expect(args.chapters).toBe(3)
  expect(args.writerExpansionMode).toBe("off")
})

test("rejects unknown writer expansion modes", () => {
  expect(() => parseArgs(["--run-id", "poc-test", "--writer-expansion-mode", "always"])).toThrow(
    /--writer-expansion-mode/,
  )
})

test("parses load-control experiment knobs", () => {
  const args = parseArgs([
    "--run-id",
    "poc-test",
    "--planning-note-preset",
    "single-obligation-hardcap-v2",
    "--obligation-control",
    "chapter-budget-v1",
    "--scene-contract-control",
    "endpoint-min-v1",
  ])

  expect(args.planningNotePreset).toBe("single-obligation-hardcap-v2")
  expect(args.obligationControl).toBe("chapter-budget-v1")
  expect(args.sceneContractControl).toBe("endpoint-min-v1")
})

test("rejects unknown scene-contract control modes", () => {
  expect(() => parseArgs(["--run-id", "poc-test", "--scene-contract-control", "compact-prose"])).toThrow(
    /--scene-contract-control/,
  )
})

test("planning note preset appends hardcap instructions without dropping directives", () => {
  const seed = applyPlanningNotePreset({
    premise: "p",
    genre: "g",
    characters: [],
    directives: {
      lockedCharacters: [],
      requiredBeats: [{ chapter: 1, description: "land endpoint", mustInclude: [] }],
      forbidden: [],
      tonalAnchors: [],
      structuralConstraints: { povRotation: "", pacing: "" },
      storyThreads: [],
      storyDebts: [],
      storyPayoffs: [],
      rawNotes: "Existing note.",
    },
  }, "single-obligation-hardcap-v2")

  expect(seed.directives?.requiredBeats).toHaveLength(1)
  expect(seed.directives?.rawNotes).toContain("Existing note.")
  expect(seed.directives?.rawNotes).toContain("single-obligation-hardcap-v2")
})

test("chapter-budget compactor preserves retained IDs and caps load", () => {
  const outline = {
    chapterNumber: 1,
    scenes: [
      {
        obligations: {
          mustEstablish: [{ text: "setup", obligationId: "obl-a", sourceId: "fact-a", sourceKind: "fact" }],
          mustTransferKnowledge: [{ text: "learns Velo target", obligationId: "obl-b", sourceId: "know-b", sourceKind: "knowledge" }],
          mustShowStateChange: [{ text: "shaken", obligationId: "obl-c", sourceId: "state-c", sourceKind: "state" }],
          mustPayOff: [],
          mustNotReveal: [],
          allowedNewEntities: [],
        },
      },
      {
        obligations: {
          mustEstablish: [{ text: "Council vote", obligationId: "obl-d", sourceId: "fact-d", sourceKind: "fact" }],
          mustTransferKnowledge: [{ text: "Maren chooses Velo meeting", obligationId: "obl-e", sourceId: "know-e", sourceKind: "knowledge", storyDebtStage: "progress" }],
          mustShowStateChange: [],
          mustPayOff: [],
          mustNotReveal: [],
          allowedNewEntities: [],
        },
      },
      {
        obligations: {
          mustEstablish: [{ text: "Maren refuses and decides", obligationId: "obl-f", sourceId: "fact-f", sourceKind: "fact", storyDebtStage: "partial_payoff", payoffId: "payoff-x" }],
          mustTransferKnowledge: [],
          mustShowStateChange: [{ text: "Maren chooses", obligationId: "obl-g", sourceId: "state-g", sourceKind: "state" }],
          mustPayOff: [],
          mustNotReveal: [],
          allowedNewEntities: [],
        },
      },
    ],
  }

  const result = compactOutlineObligationsForChapterBudget(outline)
  const keptIds = result.outline.scenes.flatMap((scene: any) =>
    Object.values(scene.obligations).flatMap((items: any) =>
      Array.isArray(items) ? items.map((item: any) => item.obligationId).filter(Boolean) : [],
    ),
  )

  expect(result.report.before).toBe(7)
  expect(result.report.after).toBe(3)
  expect(result.report.removed).toBe(4)
  expect(keptIds).toContain("obl-f")
  expect(keptIds.every((id: string) => id.startsWith("obl-"))).toBe(true)
})

test("endpoint-min scene-contract control clips payload without dropping IDs or obligations", () => {
  const outline = {
    chapterNumber: 1,
    scenes: [
      {
        sceneId: "scene-a",
        goal: "Maren must force the council to admit the warehouse transfer before Velo vanishes into procedure.",
        opposition: "The chair delays with archive rules while the foreman keeps steering attention away from Velo.",
        turningPoint: "A clerk exposes a timing gap that makes the authorized ledger impossible.",
        crisisChoice: "Maren can accuse the foreman in public with thin evidence or keep the secret and lose the vote.",
        choiceAlternatives: [
          "Accuse the foreman now and risk collapsing the hearing into procedural chaos.",
          "Stay silent and preserve decorum while Velo's trail closes.",
        ],
        outcome: "Maren names the timing gap and wins a recess instead of a verdict.",
        consequence: "The council grants one hour, making her responsible for proving the transfer before the docks close.",
        valueIn: "uncertain leverage",
        valueOut: "costly leverage",
        povPersonalStake: "If Maren fails, her inherited seal becomes proof that her family enabled the theft.",
        obligations: {
          mustEstablish: [{ obligationId: "obl-a", sourceId: "fact-a", text: "gap exists" }],
        },
      },
    ],
  }

  const result = compactOutlineSceneContractsForEndpointControl(outline, "endpoint-min-v1")
  const scene = result.outline.scenes[0]

  expect(scene.sceneId).toBe("scene-a")
  expect(scene.obligations.mustEstablish[0].obligationId).toBe("obl-a")
  expect(scene.choiceAlternatives).toEqual([])
  expect(scene.goal.length).toBeLessThanOrEqual(72)
  expect(scene.crisisChoice.length).toBeLessThanOrEqual(84)
  expect(scene.outcome).toContain("Maren")
  expect(result.report.removedChars).toBeGreaterThan(0)
  expect(result.report.choiceAlternativesBefore).toBe(2)
  expect(result.report.choiceAlternativesAfter).toBe(0)
})

test("endpoint-core scene-contract control keeps endpoint fields and clears auxiliary tags", () => {
  const outline = {
    chapterNumber: 2,
    scenes: [
      {
        sceneId: "scene-b",
        goal: "Maren has to choose whether to burn the writ or bargain with Velo.",
        opposition: "Velo offers a safer lie.",
        turningPoint: "The writ names her family.",
        crisisChoice: "Burn the writ and become complicit, or bargain with Velo and expose her family.",
        choiceAlternatives: ["Burn it.", "Bargain."],
        outcome: "Maren bargains and keeps the writ visible.",
        consequence: "Velo now knows she will trade reputation for proof.",
        valueIn: "defensive",
        valueOut: "committed",
        povPersonalStake: "The choice puts her family name on the floor.",
      },
    ],
  }

  const result = compactOutlineSceneContractsForEndpointControl(outline, "endpoint-core-v1")
  const scene = result.outline.scenes[0]

  expect(scene.goal).toContain("Maren")
  expect(scene.crisisChoice).toContain("Burn")
  expect(scene.outcome).toContain("bargains")
  expect(scene.consequence).toContain("Velo")
  expect(scene.opposition).toBeNull()
  expect(scene.turningPoint).toBeNull()
  expect(scene.valueIn).toBeNull()
  expect(scene.valueOut).toBeNull()
  expect(scene.povPersonalStake).toBeNull()
  expect(scene.choiceAlternatives).toEqual([])
  expect(result.report.clearedFields).toBeGreaterThanOrEqual(5)
})
