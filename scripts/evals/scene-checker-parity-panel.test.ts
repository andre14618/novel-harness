import { describe, expect, test } from "bun:test"
import {
  buildScenePrompt,
  classifyAgreement,
  computeMatrix,
} from "./scene-checker-parity-panel"
import type { ChapterOutline, SceneBeat } from "../../src/types"

function makeScene(overrides: Partial<SceneBeat & Record<string, unknown>> = {}): SceneBeat {
  return {
    description: "Mira finds the ledger.",
    characters: ["Mira"],
    kind: "action",
    beatId: "ch3-b1",
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
  } as SceneBeat
}

function makeOutline(scenes: SceneBeat[]): ChapterOutline {
  return {
    chapterNumber: 3,
    title: "The Ledger",
    povCharacter: "Mira",
    setting: "Archive",
    purpose: "test",
    targetWords: 1500,
    charactersPresent: ["Mira"],
    charactersPresentIds: [],
    scenes,
    establishedFacts: [],
    characterStateChanges: [],
    knowledgeChanges: [],
  } as ChapterOutline
}

describe("classifyAgreement", () => {
  test("both flagged → both-flagged", () => {
    expect(classifyAgreement(true, true)).toBe("both-flagged")
  })
  test("both clean → both-clean", () => {
    expect(classifyAgreement(false, false)).toBe("both-clean")
  })
  test("beat-only", () => {
    expect(classifyAgreement(true, false)).toBe("beat-only")
  })
  test("scene-only", () => {
    expect(classifyAgreement(false, true)).toBe("scene-only")
  })
})

describe("computeMatrix", () => {
  test("aggregates row classifications and computes agreement rate", () => {
    const matrix = computeMatrix([
      { agreement: "both-clean" } as never,
      { agreement: "both-clean" } as never,
      { agreement: "both-flagged" } as never,
      { agreement: "beat-only" } as never,
      { agreement: "scene-only" } as never,
    ])
    expect(matrix.totalScenes).toBe(5)
    expect(matrix.bothClean).toBe(2)
    expect(matrix.bothFlagged).toBe(1)
    expect(matrix.beatOnly).toBe(1)
    expect(matrix.sceneOnly).toBe(1)
    expect(matrix.agreementRate).toBeCloseTo(0.6, 2)
  })

  test("empty input returns 0% agreement", () => {
    const matrix = computeMatrix([])
    expect(matrix.totalScenes).toBe(0)
    expect(matrix.agreementRate).toBe(0)
  })
})

describe("buildScenePrompt", () => {
  test("includes scene contract fields and chapter prose", () => {
    const scene = makeScene({
      goal: "win the council vote",
      crisisChoice: "expose the steward or yield",
      outcome: "council demands a public vote",
      consequence: "Renn becomes a target",
      obligations: {
        mustShowStateChange: [{
          obligationId: "obl-renn-01",
          sourceId: "state-renn-exposed",
          sourceKind: "state" as const,
          text: "Renn publicly committed against the steward.",
        }],
        mustEstablish: [],
        mustPayOff: [],
        mustTransferKnowledge: [],
        mustNotReveal: [],
        allowedNewEntities: [],
      } as SceneBeat["obligations"],
    } as Partial<SceneBeat & Record<string, unknown>>)
    const outline = makeOutline([scene])
    const prompt = buildScenePrompt({ outline, scene, sceneIndex: 0, prose: "Renn confronted the steward." })
    expect(prompt).toContain("CHAPTER 3")
    expect(prompt).toContain("Goal: win the council vote")
    expect(prompt).toContain("obligationId=obl-renn-01")
    expect(prompt).toContain("Renn confronted the steward.")
  })

  test("renders (none declared) when contract fields are absent", () => {
    const scene = makeScene()
    const outline = makeOutline([scene])
    const prompt = buildScenePrompt({ outline, scene, sceneIndex: 0, prose: "" })
    expect(prompt).toContain("Goal: (none declared)")
    expect(prompt).toContain("Crisis choice: (none declared)")
    expect(prompt).toContain("- none")
  })
})
