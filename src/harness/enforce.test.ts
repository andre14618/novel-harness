import { expect, test } from "bun:test"

import { enforcePlanningOutput } from "./enforce"
import type { ChapterOutline, CharacterProfile, SceneBeat } from "../types"

test("planning enforcement drops same-beat payoff links before drafting", () => {
  const outline = chapter({
    scenes: [
      beat({ description: "Istra administers the cure.", requiredPayoffs: [{ fact_id: "cure-works", payoff_beat: 0 }] }),
      beat({ description: "Wren wakes." }),
      beat({ description: "Istra records the result." }),
    ],
    establishedFacts: [{ id: "cure-works", fact: "The cure works immediately", category: "knowledge" }],
  })

  const result = enforcePlanningOutput([outline], 1, [character("Istra Venn")])

  expect(result.valid).toBe(true)
  expect(result.chapters[0].scenes[0].requiredPayoffs).toEqual([])
  expect(result.warnings[0]).toContain("dropped payoff link")
  expect(result.warnings[0]).toContain("non-forward payoff beat 1")
})

test("planning enforcement keeps valid forward payoff links", () => {
  const outline = chapter({
    scenes: [
      beat({ description: "Istra plants a clue.", requiredPayoffs: [{ fact_id: "cure-works", payoff_beat: 1 }] }),
      beat({ description: "Wren wakes." }),
      beat({ description: "Istra records the result." }),
    ],
    establishedFacts: [{ id: "cure-works", fact: "The cure works immediately", category: "knowledge" }],
  })

  const result = enforcePlanningOutput([outline], 1, [character("Istra Venn")])

  expect(result.valid).toBe(true)
  expect(result.chapters[0].scenes[0].requiredPayoffs).toEqual([{ fact_id: "cure-works", payoff_beat: 1 }])
  expect(result.warnings).toEqual([])
})

test("planning enforcement uses calibrated beat count floor", () => {
  const outline = chapter({
    targetWords: 1500,
    scenes: [
      beat({ description: "Istra finds the missing dose." }),
      beat({ description: "Wren refuses the treatment." }),
      beat({ description: "Istra proves the danger." }),
    ],
  })

  const result = enforcePlanningOutput([outline], 1, [character("Istra Venn")])

  expect(result.valid).toBe(false)
  expect(result.errors).toEqual(["Chapter 1: 3 beats below floor 4 for 1500w target"])
})

test("planning enforcement accepts a compact 1500 word chapter at four beats", () => {
  const outline = chapter({
    targetWords: 1500,
    scenes: [
      beat({ description: "Istra finds the missing dose." }),
      beat({ description: "Wren refuses the treatment." }),
      beat({ description: "Istra proves the danger." }),
      beat({ description: "Wren accepts the cost." }),
    ],
  })

  const result = enforcePlanningOutput([outline], 1, [character("Istra Venn")])

  expect(result.valid).toBe(true)
  expect(result.errors).toEqual([])
})

function chapter(overrides: Partial<ChapterOutline> = {}): ChapterOutline {
  return {
    chapterNumber: 1,
    title: "The Treatment",
    povCharacter: "Istra Venn",
    setting: "The Chancel Infirmary",
    purpose: "Test payoff sanitation",
    targetWords: 300,
    charactersPresent: ["Istra Venn"],
    charactersPresentIds: [],
    scenes: [beat()],
    establishedFacts: [],
    characterStateChanges: [],
    knowledgeChanges: [],
    ...overrides,
  }
}

function beat(overrides: Partial<SceneBeat> = {}): SceneBeat {
  return {
    description: "Istra treats Wren.",
    characters: ["Istra Venn"],
    kind: "action",
    requiredPayoffs: [],
    obligations: { mustEstablish: [], mustPayOff: [], mustTransferKnowledge: [], mustShowStateChange: [], mustNotReveal: [], allowedNewEntities: [] },
    lifeValueAxes: [],
    miceActive: [],
    miceOpens: [],
    miceCloses: [],
    ...overrides,
  }
}

function character(name: string): CharacterProfile {
  return {
    id: name.toLowerCase().replaceAll(" ", "_"),
    name,
    role: "protagonist",
    backstory: "",
    traits: [],
    speechPattern: "",
    goals: "",
    fears: "",
    relationships: [],
    culturalBackground: [],
    systemAwareness: [],
    exampleLines: [],
  }
}
